/*
    from https://github.com/antimatter15/splat/blob/main/main.js
*/

export const vertex = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

const float SH_C0 = 0.28209479177387814;
const float SH_C1 = 0.4886025119029199;

uniform highp usampler2D u_texture;
uniform highp usampler2D u_shTexture;
uniform mat4 projection, view;
uniform vec2 focal;
uniform vec2 viewport;

uniform bool u_useDepthFade;
uniform float u_depthFade;

in vec2 position;
in int index;

out vec4 vColor;
out vec2 vPosition;

void main () {

    uvec4 cen = texelFetch(u_texture, ivec2((uint(index) & 0x3ffu) << 1, uint(index) >> 10), 0);
    vec3 p = uintBitsToFloat(cen.xyz);
    vec4 cam = view * vec4(p, 1);
    vec4 pos2d = projection * cam;

    float clip = 1.2 * pos2d.w;
    if (pos2d.z < -pos2d.w || pos2d.x < -clip || pos2d.x > clip || pos2d.y < -clip || pos2d.y > clip) {
        gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
        return;
    }

    uvec4 cov = texelFetch(u_texture, ivec2(((uint(index) & 0x3ffu) << 1) | 1u, uint(index) >> 10), 0);
    vec2 u1 = unpackHalf2x16(cov.x), u2 = unpackHalf2x16(cov.y), u3 = unpackHalf2x16(cov.z);
    mat3 Vrk = mat3(u1.x, u1.y, u2.x, u1.y, u2.y, u3.x, u2.x, u3.x, u3.y);

    mat3 J = mat3(
        focal.x / cam.z, 0., -(focal.x * cam.x) / (cam.z * cam.z), 
        0., -focal.y / cam.z, (focal.y * cam.y) / (cam.z * cam.z), 
        0., 0., 0.
    );

    mat3 T = transpose(mat3(view)) * J;
    mat3 cov2d = transpose(T) * Vrk * T;

    float mid = (cov2d[0][0] + cov2d[1][1]) / 2.0;
    float radius = length(vec2((cov2d[0][0] - cov2d[1][1]) / 2.0, cov2d[0][1]));
    float lambda1 = mid + radius, lambda2 = mid - radius;

    if(lambda2 < 0.0) return;
    vec2 diagonalVector = normalize(vec2(cov2d[0][1], lambda1 - cov2d[0][0]));
    vec2 majorAxis = min(sqrt(2.0 * lambda1), 1024.0) * diagonalVector;
    vec2 minorAxis = min(sqrt(2.0 * lambda2), 1024.0) * vec2(diagonalVector.y, -diagonalVector.x);

    // vColor = vec4((cov.w) & 0xffu, (cov.w >> 8) & 0xffu, (cov.w >> 16) & 0xffu, (cov.w >> 24) & 0xffu) / 255.0;

    //color based on spherical harmonics
    uvec4 shs0 = texelFetch(u_shTexture, ivec2(((uint(index) & 0xffu) << 3), uint(index) >> 8), 0);
    vec2 C0xy = unpackHalf2x16(shs0.x);
    vec2 C0zC1x = unpackHalf2x16(shs0.y);
    vec2 C1yC1z = unpackHalf2x16(shs0.z);
    vec2 C2xC2y = unpackHalf2x16(shs0.t);
    
    uvec4 shs1 = texelFetch(u_shTexture, ivec2(((uint(index) & 0xffu) << 3) | 1u, uint(index) >> 8), 0);
    vec2 C2zC3x = unpackHalf2x16(shs1.x);
    vec2 C3yC3z = unpackHalf2x16(shs1.y);

    vec3 result = SH_C0*vec3(C0xy.x, C0xy.y, C0zC1x.x);
    vec3 dir = normalize(p - inverse(view)[3].xyz);
    
    vec3 sh1 = vec3(C0zC1x.y, C1yC1z.x, C1yC1z.y);
    vec3 sh2 = vec3(C2xC2y.x, C2xC2y.y, C2zC3x.x);
    vec3 sh3 = vec3(C2zC3x.y, C3yC3z.x, C3yC3z.y);

    result = result - ((SH_C1 * dir.y) * sh1) +  ((SH_C1 * dir.z) * sh2) -  ((SH_C1 * dir.x) * sh3);

    vec3 dc = 255.0 * (0.5  + result);
    vColor = vec4(dc, ((cov.w >> 24) & 0xffu)) / 255.0;

    vPosition = position;

    float scalingFactor = 1.0;

    if(u_useDepthFade) {
        float depthNorm = (pos2d.z / pos2d.w + 1.0) / 2.0;
        float near = 0.1; float far = 100.0;
        float normalizedDepth = (2.0 * near) / (far + near - depthNorm * (far - near));
        float start = max(normalizedDepth - 0.1, 0.0);
        float end = min(normalizedDepth + 0.1, 1.0);
        scalingFactor = clamp((u_depthFade - start) / (end - start), 0.0, 1.0);
    }

    vec2 vCenter = vec2(pos2d) / pos2d.w;
    gl_Position = vec4(
        vCenter 
        + position.x * majorAxis * scalingFactor / viewport 
        + position.y * minorAxis * scalingFactor / viewport, 0.0, 1.0);

}
`;
