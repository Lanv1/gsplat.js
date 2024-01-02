/*
    from https://github.com/antimatter15/splat/blob/main/main.js
*/

export const vertex = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

const float SH_C0 = 0.28209479177387814;
const float SH_C1 = 0.4886025119029199;
const float SH_C2[5] = float[](
    1.0925484305920792,
    -1.0925484305920792,
    0.31539156525252005,
    -1.0925484305920792,
    0.5462742152960396
);

const float SH_C3[7] = float[](
    -0.5900435899266435,
    2.890611442640554,
    -0.4570457994644658,
    0.3731763325901154,
    -0.4570457994644658,
    1.445305721320277,
    -0.5900435899266435
);

// from the packed 8 + 8 floats (from one channel) fill in the shs (layout(rgb, rgb, ...., rgb))
void fill_sh_from_packed(in uvec4 packed0, in uvec4 packed1, in int offset, inout float shs[48]) {
    float sorted[16];

    int ind = 0;
    for(int i = 0; i < 4; i ++) {
        vec2 v = unpackHalf2x16(packed0[i]);
        sorted[ind] = v.x;
        sorted[ind+1] = v.y;

        ind += 2;
    }

    for(int i = 0; i < 4; i ++) {
        vec2 v = unpackHalf2x16(packed1[i]);
        sorted[ind] = v.x;
        sorted[ind+1] = v.y;

        ind += 2;
    }

    int stride = 3;
    for(int i = 0; i < 16; i ++) {
        shs[offset + (i*stride)] = sorted[i];
    }
}


vec3 eval_sh_rgb(highp usampler2D tex_r, highp usampler2D tex_g, highp usampler2D tex_b, int index, uint deg, vec3 dir) {
    float shs[48];

    uvec4 packed_r0 = texelFetch(tex_r, ivec2(((uint(index) & 0x3ffu) << 1), uint(index) >> 10), 0);
    uvec4 packed_r1 = texelFetch(tex_r, ivec2(((uint(index) & 0x3ffu) << 1) | 1u, uint(index) >> 10), 0);
    fill_sh_from_packed(packed_r0, packed_r1, 0, shs);

    uvec4 packed_g0 = texelFetch(tex_g, ivec2(((uint(index) & 0x3ffu) << 1), uint(index) >> 10), 0);
    uvec4 packed_g1 = texelFetch(tex_g, ivec2(((uint(index) & 0x3ffu) << 1) | 1u, uint(index) >> 10), 0);
    fill_sh_from_packed(packed_g0, packed_g1, 1, shs);

    uvec4 packed_b0 = texelFetch(tex_b, ivec2(((uint(index) & 0x3ffu) << 1), uint(index) >> 10), 0);
    uvec4 packed_b1 = texelFetch(tex_b, ivec2(((uint(index) & 0x3ffu) << 1) | 1u, uint(index) >> 10), 0);
    fill_sh_from_packed(packed_b0, packed_b1, 2, shs);
    
    vec3 result = SH_C0 * vec3(shs[0], shs[1], shs[2]);

    if(deg > 0u) {
        float x = dir.x, y = dir.y, z = dir.z;
        result -= (SH_C1 * y * vec3(shs[3], shs[4], shs[5])) + 
            (SH_C1 * z * vec3(shs[6], shs[7], shs[8])) - 
            (SH_C1 * x * vec3(shs[9], shs[10], shs[11]));

        if(deg > 1u) {
            float xx = x*x, yy = y*y, zz = z*z;
            float xy = x * y, yz = y * z, xz = x * z;

            result += (SH_C2[0] * xy * vec3(shs[12], shs[13], shs[14])) +
                (SH_C2[1] * yz * vec3(shs[15], shs[16], shs[17])) +
                (SH_C2[2] * (2.0 * zz - xx - yy) * vec3(shs[18], shs[19], shs[20])) +
                (SH_C2[3] * xz * vec3(shs[21], shs[22], shs[23])) +
                (SH_C2[4] * (xx - yy) * vec3(shs[24], shs[25], shs[26]));

            if(deg > 2u) {
                result += (SH_C3[0] * y * (3.0 * xx - yy) * vec3(shs[27], shs[28], shs[29])) +
                    (SH_C3[1] * xy * z * vec3(shs[30], shs[31], shs[32])) +
                    (SH_C3[2] * y * (4.0 * zz - xx - yy)* vec3(shs[33], shs[34], shs[35])) +
                    (SH_C3[3] * z * (2.0 * zz - 3.0 * xx - 3.0 * yy) * vec3(shs[36], shs[37], shs[38])) +
                    (SH_C3[4] * x * (4.0 * zz - xx - yy) * vec3(shs[39], shs[40], shs[41])) +
                    (SH_C3[5] * z * (xx - yy) * vec3(shs[42], shs[43], shs[44])) +
                    (SH_C3[6] * x * (xx - 3.0 * yy) * vec3(shs[45], shs[46], shs[47]));
            }
        }
    }

    result += 0.5;
    return vec3(max(result.x, 0.), max(result.y, 0.), max(result.z, 0.));
}



uniform highp usampler2D u_texture;
// uniform highp usampler2D u_shTexture;

uniform highp usampler2D u_sh_r;
uniform highp usampler2D u_sh_g;
uniform highp usampler2D u_sh_b;

uniform mat4 projection, view;
uniform vec2 focal;
uniform vec2 viewport;
uniform vec3 camPos;

uniform bool u_useDepthFade;
uniform float u_depthFade;

// uniform bool u_use_shs;
uniform int u_band0count;

in vec2 position;
in int index;

out vec4 vColor;
out vec2 vPosition;

void main () {
    bool use_shs = false;

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

    vec3 rgb;
    float opacity = float((cov.w >> 24) & 0xffu) / 255.0;
    
    if(index >= u_band0count) {
        use_shs = true;
    }

    // use_shs = false;

    //color based on spherical harmonics
    if(use_shs) {
        int tex_index = index - u_band0count;
        const uint deg = 3u;    
        mat4 inverted_view = inverse(view);
        vec3 dir = normalize(p - inverted_view[3].xyz);

        rgb = eval_sh_rgb(u_sh_r, u_sh_g, u_sh_b, tex_index, deg, dir);
        rgb = vec3(min(rgb.x, 1.), min(rgb.y, 1.), min(rgb.z, 1.));
        
    } else {

        rgb = vec3((cov.w) & 0xffu, (cov.w >> 8) & 0xffu, (cov.w >> 16) & 0xffu) / 255.0;
    }

    vColor = vec4(rgb, opacity);

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