
const C0 = 0.28209479177387814
const C1 = 0.4886025119029199
const C2 = [
    1.0925484305920792,
    -1.0925484305920792,
    0.31539156525252005,
    -1.0925484305920792,
    0.5462742152960396
]

const C3 = [
    -0.5900435899266435,
    2.890611442640554,
    -0.4570457994644658,
    0.3731763325901154,
    -0.4570457994644658,
    1.445305721320277,
    -0.5900435899266435
]
const C4 = [
    2.5033429417967046,
    -1.7701307697799304,
    0.9461746957575601,
    -0.6690465435572892,
    0.10578554691520431,
    -0.6690465435572892,
    0.47308734787878004,
    -1.7701307697799304,
    0.6258357354491761,
]   


function eval_sh(degs: Uint8Array, sh: Float32Array, dirs: Float32Array): Uint8Array {
    // Evaluate spherical harmonics at unit directions
    // using hardcoded SH polynomials.
    // Args:
    //     deg: int SH deg per gaussian. Currently, 0-3 supported: size = G
    //     sh: SH coeffs: size = G * (3 * ((deg + 1) ** 2))
    //     dirs: unit directions: (gaussian center - camPos), size = G * 3
    // Returns:
    //     Uint8Array of colors: size = G * 3 
    
    const nbG = degs.length;
    let result = new Uint8Array(nbG);

    for(let i = 0; i < nbG; i ++) {
        const deg = degs[i];
        const shLength = 3 * ((deg+1) ** 2);

        result[i*3] = C0 * sh[i*shLength];
        result[i*3 + 1] = C0 * sh[i*shLength + 1];
        result[i*3 + 2] = C0 * sh[i*shLength + 2];

        if(deg > 0) {
            const x = dirs[i*3], y = dirs[i*3 + 1], z = dirs[i*3 + 2]; 

            const C1_0 = [
                C1 * y * sh[i*shLength+3],
                C1 * y * sh[i*shLength+4],
                C1 * y * sh[i*shLength+5]
            ];

            const C1_1 = [
                C1 * z * sh[i*shLength+6],
                C1 * z * sh[i*shLength+7],
                C1 * z * sh[i*shLength+8]
            ];

            const C1_2 = [
                C1 * x * sh[i*shLength+9],
                C1 * x * sh[i*shLength+10],
                C1 * x * sh[i*shLength+11]
            ];
            
            result[i*3] -= C1_0[0] + C1_1[0] - C1_2[0]; 
            result[i*3+1] -= C1_0[1] + C1_1[1]- C1_2[1];
            result[i*3+2] -= C1_0[2] + C1_1[2]- C1_2[2];
            
            if(deg > 1) {
                const xx = x*x, xy = x*y, yz = y*z, xz = x*z, yy = y*y, zz = z*z;
                
                const C2_0 = [
                    C2[0] * xy * sh[i*shLength+12],
                    C2[0] * xy * sh[i*shLength+13],
                    C2[0] * xy * sh[i*shLength+14]
                ];
                
                const C2_1 = [
                    C2[1] * yz * sh[i*shLength+15],
                    C2[1] * yz * sh[i*shLength+16],
                    C2[1] * yz * sh[i*shLength+17]
                ];
                
                const C2_2 = [
                    C2[2] * 2*(zz - xx - yy) * sh[i*shLength+18],
                    C2[2] * 2*(zz - xx - yy) * sh[i*shLength+19],
                    C2[2] * 2*(zz - xx - yy) * sh[i*shLength+20]
                ];
                
                const C2_3 = [
                    C2[3] * xz * sh[i*shLength+21],
                    C2[3] * xz * sh[i*shLength+22],
                    C2[3] * xz * sh[i*shLength+23]
                ];
                
                const C2_4 = [
                    C2[4] * (xx - yy) * sh[i*shLength+24],
                    C2[4] * (xx - yy) * sh[i*shLength+25],
                    C2[4] * (xx - yy) * sh[i*shLength+26]
                ];

                result[i*3] += C2_0[0] + C2_1[0] + C2_2[0] + C2_3[0] + C2_4[0]; 
                result[i*3+1] += C2_0[1] + C2_1[1] + C2_2[1]+ C2_3[1] + C2_4[1];
                result[i*3+2] += C2_0[2] + C2_1[2] + C2_2[2]+ C2_3[2] + C2_4[2];

                if(deg > 2) {
                    const C3_0 = [
                        C3[0] * y * (3 * xx - yy) * sh[i*shLength+27],
                        C3[0] * y * (3 * xx - yy) * sh[i*shLength+28],
                        C3[0] * y * (3 * xx - yy) * sh[i*shLength+29]
                    ];
                    
                    const C3_1 = [
                        C3[1] * xy * z * sh[i*shLength+30],
                        C3[1] * xy * z * sh[i*shLength+31],
                        C3[1] * xy * z * sh[i*shLength+32]
                    ];
                    
                    const C3_2 = [
                        C3[2] * y * (4 * zz - xx - yy) * sh[i*shLength+33],
                        C3[2] * y * (4 * zz - xx - yy) * sh[i*shLength+34],
                        C3[2] * y * (4 * zz - xx - yy) * sh[i*shLength+35],
                    ];
                    
                    const C3_3 = [
                        C3[3] * z * (2 * zz - 3 * xx - 3 * yy) * sh[i*shLength+36],
                        C3[3] * z * (2 * zz - 3 * xx - 3 * yy) * sh[i*shLength+37],
                        C3[3] * z * (2 * zz - 3 * xx - 3 * yy) * sh[i*shLength+38]
                    ];
                    
                    const C3_4 = [
                        C3[4] * x * (4 * zz - xx - yy) * sh[i*shLength+39],
                        C3[4] * x * (4 * zz - xx - yy) * sh[i*shLength+40],
                        C3[4] * x * (4 * zz - xx - yy) * sh[i*shLength+41],
                    ];

                    const C3_5 = [
                        C3[2] * z * (xx - yy) * sh[i*shLength+42],
                        C3[2] * z * (xx - yy) * sh[i*shLength+43],
                        C3[2] * z * (xx - yy) * sh[i*shLength+44]
                    ];
                    
                    const C3_6 = [
                        C3[3] * x * (xx - 3 * yy) * sh[i*shLength+45],
                        C3[3] * x * (xx - 3 * yy) * sh[i*shLength+46],
                        C3[3] * x * (xx - 3 * yy) * sh[i*shLength+47]
                    ];

                    result[i*3] += C3_0[0] + C3_1[0] + C3_2[0] + C3_3[0] + C3_4[0] + C3_5[0] + C3_6[0]; 
                    result[i*3] += C3_0[1] + C3_1[1] + C3_2[1] + C3_3[1] + C3_4[1] + C3_5[1] + C3_6[1]; 
                    result[i*3] += C3_0[2] + C3_1[2] + C3_2[2] + C3_3[2] + C3_4[2] + C3_5[2] + C3_6[2]; 
                }
            }
        }
    }

    return result;
} 

function RGB2SH(rgb: Uint8Array) : Float32Array {
    return new Float32Array([rgb[0] - 0.5 / C0, rgb[1] - 0.5 / C0, rgb[2] - 0.5 / C0]);
}

function SH2RGB(sh: Float32Array ) : Uint8Array {
    return new Uint8Array([sh[0] * C0 + 0.5, sh[1] * C0 + 0.5, sh[2] * C0 + 0.5]);
}

export default eval_sh;