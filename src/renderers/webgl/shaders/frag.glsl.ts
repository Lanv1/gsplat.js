/*
    from https://github.com/antimatter15/splat/blob/main/main.js
*/

export const frag = /* glsl */ `#version 300 es
precision highp float;

in vec4 vColor;
in vec2 vPosition;

out vec4 fragColor;

void main () {
    float A = -dot(vPosition, vPosition);
    if (A < -4.0) discard;
    float B = exp(A) * vColor.a;

    B = min(B, 1.);
    B = max(B, 0.);
    fragColor = vec4(B * vColor.rgb, B);
}
`;
