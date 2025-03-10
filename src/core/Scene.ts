import { Matrix3 } from "../math/Matrix3";
import { Quaternion } from "../math/Quaternion";
import { Vector3 } from "../math/Vector3";
import { EventDispatcher } from "./EventDispatcher";
import { packHalf2x16 } from "../utils";
import { int16ToFloat32 } from "../utils";

class Scene extends EventDispatcher {
    static RowLength = 3 * 4 + 3 * 4 + 4 + 4;

    private _data: Uint32Array;
    private _width: number;
    private _height: number;
    private _vertexCount: number;
    private _positions: Float32Array;
    private _rotations: Float32Array;
    private _scales: Float32Array;
    private _shs: Uint32Array;
    private _shHeight: number;

    private _g0bands: number;
    private _bandsIndices: Int32Array;


    private _shs_rgb: [Uint32Array, Uint32Array, Uint32Array];

    setData: (data: Uint8Array, shs?: Float32Array) => void;
    translate: (translation: Vector3) => void;
    rotate: (rotation: Quaternion) => void;
    scale: (scale: Vector3) => void;
    limitBox: (xMin: number, xMax: number, yMin: number, yMax: number, zMin: number, zMax: number) => void;
    saveToFile: (name: string) => void;

    updateColor: (camPos: Vector3) => void;

    constructor() {
        super();

        const packHalfs = (x: number, y: number) => {
            return (x | (y << 16)) >>> 0;
        };

        const changeEvent = { type: "change" } as Event;

        this._data = new Uint32Array(0);
        this._vertexCount = 0;
        this._width = 2048;
        this._height = 0;
        this._shHeight = 0;
        this._positions = new Float32Array(0);
        this._rotations = new Float32Array(0);
        this._scales = new Float32Array(0);
        this._shs = new Uint32Array(0);
        this._shs_rgb = [new Uint32Array(0), new Uint32Array(0), new Uint32Array(0)];
        this._g0bands = 0;
        this._bandsIndices = new Int32Array([-1, -1 , -1]);

        this.setData = (data: Uint8Array, shs?: Float32Array) => {
            if(typeof shs == 'undefined') {
                console.log("NO SHS");
            }
            this._vertexCount = data.length / Scene.RowLength;
            
            // console.log("VERTEX COUNT (for data storage in tex ): " + this._vertexCount);
            // const g3bands = this.vertexCount - (this.bandsIndices[0]+1);
            const shSize = this.vertexCount - (this.bandsIndices[0]+1);
            
            // let shSize;
            // if(this.bandsIndices[0] > 0) {
            //     shSize = this.vertexCount - (this.bandsIndices[0]+1);
            // } else {
            //     shSize = this.vertexCount;
            // }
            
            // console.log(`${shSize} gaussians with 1,2 or 3 bands.`);

            this._height = Math.ceil((2 * this._vertexCount) / this._width);
            this._data = new Uint32Array(this._width * this._height * 4);
            this._positions = new Float32Array(3 * this._vertexCount);
            this._rotations = new Float32Array(4 * this._vertexCount);
            this._scales = new Float32Array(3 * this._vertexCount);

            let shs_ind = 0;
            if(typeof shs != 'undefined') {
                this._shHeight = Math.ceil((2 * shSize) / this._width);
                //padding added
                // this._shs = new Uint32Array(this._width* this._shHeight * 4);

                // no pad needed: 16F32 -> 8F32 using half16 packing so each sh texture is the same size as data texture !
                this._shs_rgb = [
                    new Uint32Array(this._width * this._shHeight * 4),
                    new Uint32Array(this._width * this._shHeight * 4),
                    new Uint32Array(this._width * this._shHeight * 4)
                ];
            }

            const f_buffer = new Float32Array(data.buffer);
            const u_buffer = new Uint8Array(data.buffer);

            const data_c = new Uint8Array(this._data.buffer);
            const data_f = new Float32Array(this._data.buffer);
            
            const shs_f = new Float32Array(this._shs.buffer);
            const stride = 3;

            if(typeof shs != 'undefined') {
                for(let i = 0; i < shSize; i ++) {
                    // pack input F32 shs to H16 inside the scene.
                    // for(let j = 0; j < 48; j +=2) {
                    //     this._shs[shs_ind] = packHalf2x16(shs[i*48+j], shs[i*48+(j+1)]);
                    //     shs_ind ++;
                    // }
                    // shs_ind += 8;

                    // BETTER: pack them in 3 textures (one per component)       
                    let ind = (i*48);
                    for(let j = 0; j < 8; j ++) {
                        this._shs_rgb[0][8*i + j] = packHalf2x16(shs[ind], shs[ind+stride]);
                        this._shs_rgb[1][8*i + j] = packHalf2x16(shs[ind+1], shs[ind+stride+1]);
                        this._shs_rgb[2][8*i + j] = packHalf2x16(shs[ind+2], shs[ind+stride+2]);
                        ind +=6;
                    }
                }
            }

            for (let i = 0; i < this._vertexCount; i++) {
                
                this._positions[3 * i + 0] = f_buffer[8 * i + 0];
                this._positions[3 * i + 1] = f_buffer[8 * i + 1];
                this._positions[3 * i + 2] = f_buffer[8 * i + 2];

                this._rotations[4 * i + 0] = (u_buffer[32 * i + 28 + 0] - 128) / 128;
                this._rotations[4 * i + 1] = (u_buffer[32 * i + 28 + 1] - 128) / 128;
                this._rotations[4 * i + 2] = (u_buffer[32 * i + 28 + 2] - 128) / 128;
                this._rotations[4 * i + 3] = (u_buffer[32 * i + 28 + 3] - 128) / 128;

                this._scales[3 * i + 0] = f_buffer[8 * i + 3 + 0];
                this._scales[3 * i + 1] = f_buffer[8 * i + 3 + 1];
                this._scales[3 * i + 2] = f_buffer[8 * i + 3 + 2];

                data_f[8 * i + 0] = this._positions[3 * i + 0];
                data_f[8 * i + 1] = this._positions[3 * i + 1];
                data_f[8 * i + 2] = this._positions[3 * i + 2];

                data_c[4 * (8 * i + 7) + 0] = u_buffer[32 * i + 24 + 0];
                data_c[4 * (8 * i + 7) + 1] = u_buffer[32 * i + 24 + 1];
                data_c[4 * (8 * i + 7) + 2] = u_buffer[32 * i + 24 + 2];
                data_c[4 * (8 * i + 7) + 3] = u_buffer[32 * i + 24 + 3];

                const rot = Matrix3.RotationFromQuaternion(
                    new Quaternion(
                        this._rotations[4 * i + 1],
                        this._rotations[4 * i + 2],
                        this._rotations[4 * i + 3],
                        -this._rotations[4 * i + 0],
                    ),
                );

                const scale = Matrix3.Diagonal(
                    new Vector3(this._scales[3 * i + 0], this._scales[3 * i + 1], this._scales[3 * i + 2]),
                );

                const M = scale.multiply(rot).buffer;

                const sigma = [
                    M[0] * M[0] + M[3] * M[3] + M[6] * M[6],
                    M[0] * M[1] + M[3] * M[4] + M[6] * M[7],
                    M[0] * M[2] + M[3] * M[5] + M[6] * M[8],
                    M[1] * M[1] + M[4] * M[4] + M[7] * M[7],
                    M[1] * M[2] + M[4] * M[5] + M[7] * M[8],
                    M[2] * M[2] + M[5] * M[5] + M[8] * M[8],
                ];

                this._data[8 * i + 4] = packHalf2x16(4 * sigma[0], 4 * sigma[1]);
                this._data[8 * i + 5] = packHalf2x16(4 * sigma[2], 4 * sigma[3]);
                this._data[8 * i + 6] = packHalf2x16(4 * sigma[4], 4 * sigma[5]);
            }

            this.dispatchEvent(changeEvent);
        };

        this.translate = (translation: Vector3) => {
            const data_f = new Float32Array(this._data.buffer);
            for (let i = 0; i < this._vertexCount; i++) {
                this._positions[3 * i + 0] += translation.x;
                this._positions[3 * i + 1] += translation.y;
                this._positions[3 * i + 2] += translation.z;

                data_f[8 * i + 0] = this._positions[3 * i + 0];
                data_f[8 * i + 1] = this._positions[3 * i + 1];
                data_f[8 * i + 2] = this._positions[3 * i + 2];
            }

            this.dispatchEvent(changeEvent);
        };

        this.rotate = (rotation: Quaternion) => {
            const R = Matrix3.RotationFromQuaternion(rotation).buffer;
            const data_f = new Float32Array(this._data.buffer);

            for (let i = 0; i < this._vertexCount; i++) {
                const x = this._positions[3 * i + 0];
                const y = this._positions[3 * i + 1];
                const z = this._positions[3 * i + 2];

                this._positions[3 * i + 0] = R[0] * x + R[1] * y + R[2] * z;
                this._positions[3 * i + 1] = R[3] * x + R[4] * y + R[5] * z;
                this._positions[3 * i + 2] = R[6] * x + R[7] * y + R[8] * z;

                data_f[8 * i + 0] = this._positions[3 * i + 0];
                data_f[8 * i + 1] = this._positions[3 * i + 1];
                data_f[8 * i + 2] = this._positions[3 * i + 2];

                const currentRotation = new Quaternion(
                    this._rotations[4 * i + 1],
                    this._rotations[4 * i + 2],
                    this._rotations[4 * i + 3],
                    this._rotations[4 * i + 0],
                );

                const newRot = rotation.multiply(currentRotation);
                this._rotations[4 * i + 1] = newRot.x;
                this._rotations[4 * i + 2] = newRot.y;
                this._rotations[4 * i + 3] = newRot.z;
                this._rotations[4 * i + 0] = newRot.w;

                const rot = Matrix3.RotationFromQuaternion(
                    new Quaternion(
                        this._rotations[4 * i + 1],
                        this._rotations[4 * i + 2],
                        this._rotations[4 * i + 3],
                        -this._rotations[4 * i + 0],
                    ),
                );

                const scale = Matrix3.Diagonal(
                    new Vector3(this._scales[3 * i + 0], this._scales[3 * i + 1], this._scales[3 * i + 2]),
                );

                const M = scale.multiply(rot).buffer;

                const sigma = [
                    M[0] * M[0] + M[3] * M[3] + M[6] * M[6],
                    M[0] * M[1] + M[3] * M[4] + M[6] * M[7],
                    M[0] * M[2] + M[3] * M[5] + M[6] * M[8],
                    M[1] * M[1] + M[4] * M[4] + M[7] * M[7],
                    M[1] * M[2] + M[4] * M[5] + M[7] * M[8],
                    M[2] * M[2] + M[5] * M[5] + M[8] * M[8],
                ];

                this._data[8 * i + 4] = packHalf2x16(4 * sigma[0], 4 * sigma[1]);
                this._data[8 * i + 5] = packHalf2x16(4 * sigma[2], 4 * sigma[3]);
                this._data[8 * i + 6] = packHalf2x16(4 * sigma[4], 4 * sigma[5]);
            }

            this.dispatchEvent(changeEvent);
        };

        this.scale = (scale: Vector3) => {
            const data_f = new Float32Array(this._data.buffer);

            for (let i = 0; i < this.vertexCount; i++) {
                this._positions[3 * i + 0] *= scale.x;
                this._positions[3 * i + 1] *= scale.y;
                this._positions[3 * i + 2] *= scale.z;

                data_f[8 * i + 0] = this._positions[3 * i + 0];
                data_f[8 * i + 1] = this._positions[3 * i + 1];
                data_f[8 * i + 2] = this._positions[3 * i + 2];

                this._scales[3 * i + 0] *= scale.x;
                this._scales[3 * i + 1] *= scale.y;
                this._scales[3 * i + 2] *= scale.z;

                const rot = Matrix3.RotationFromQuaternion(
                    new Quaternion(
                        this._rotations[4 * i + 1],
                        this._rotations[4 * i + 2],
                        this._rotations[4 * i + 3],
                        -this._rotations[4 * i + 0],
                    ),
                );

                const newScale = Matrix3.Diagonal(
                    new Vector3(this._scales[3 * i + 0], this._scales[3 * i + 1], this._scales[3 * i + 2]),
                );

                const M = newScale.multiply(rot).buffer;

                const sigma = [
                    M[0] * M[0] + M[3] * M[3] + M[6] * M[6],
                    M[0] * M[1] + M[3] * M[4] + M[6] * M[7],
                    M[0] * M[2] + M[3] * M[5] + M[6] * M[8],
                    M[1] * M[1] + M[4] * M[4] + M[7] * M[7],
                    M[1] * M[2] + M[4] * M[5] + M[7] * M[8],
                    M[2] * M[2] + M[5] * M[5] + M[8] * M[8],
                ];

                this._data[8 * i + 4] = packHalf2x16(4 * sigma[0], 4 * sigma[1]);
                this._data[8 * i + 5] = packHalf2x16(4 * sigma[2], 4 * sigma[3]);
                this._data[8 * i + 6] = packHalf2x16(4 * sigma[4], 4 * sigma[5]);
            }

            this.dispatchEvent(changeEvent);
        };

        this.limitBox = (xMin: number, xMax: number, yMin: number, yMax: number, zMin: number, zMax: number) => {
            if (xMin >= xMax) {
                throw new Error(`xMin (${xMin}) must be smaller than xMax (${xMax})`);
            }
            if (yMin >= yMax) {
                throw new Error(`yMin (${yMin}) must be smaller than yMax (${yMax})`);
            }
            if (zMin >= zMax) {
                throw new Error(`zMin (${zMin}) must be smaller than zMax (${zMax})`);
            }

            const mask = new Uint8Array(this._vertexCount);
            for (let i = 0; i < this._vertexCount; i++) {
                const x = this._positions[3 * i + 0];
                const y = this._positions[3 * i + 1];
                const z = this._positions[3 * i + 2];

                if (x >= xMin && x <= xMax && y >= yMin && y <= yMax && z >= zMin && z <= zMax) {
                    mask[i] = 1;
                }
            }

            let newIndex = 0;
            for (let i = 0; i < this._vertexCount; i++) {
                if (mask[i] === 0) continue;

                this._data[8 * newIndex + 0] = this._data[8 * i + 0];
                this._data[8 * newIndex + 1] = this._data[8 * i + 1];
                this._data[8 * newIndex + 2] = this._data[8 * i + 2];
                this._data[8 * newIndex + 3] = this._data[8 * i + 3];
                this._data[8 * newIndex + 4] = this._data[8 * i + 4];
                this._data[8 * newIndex + 5] = this._data[8 * i + 5];
                this._data[8 * newIndex + 6] = this._data[8 * i + 6];
                this._data[8 * newIndex + 7] = this._data[8 * i + 7];

                this._positions[3 * newIndex + 0] = this._positions[3 * i + 0];
                this._positions[3 * newIndex + 1] = this._positions[3 * i + 1];
                this._positions[3 * newIndex + 2] = this._positions[3 * i + 2];

                this._rotations[4 * newIndex + 0] = this._rotations[4 * i + 0];
                this._rotations[4 * newIndex + 1] = this._rotations[4 * i + 1];
                this._rotations[4 * newIndex + 2] = this._rotations[4 * i + 2];
                this._rotations[4 * newIndex + 3] = this._rotations[4 * i + 3];

                this._scales[3 * newIndex + 0] = this._scales[3 * i + 0];
                this._scales[3 * newIndex + 1] = this._scales[3 * i + 1];
                this._scales[3 * newIndex + 2] = this._scales[3 * i + 2];

                newIndex += 1;
            }

            this._height = Math.ceil((2 * newIndex) / this._width);
            this._vertexCount = newIndex;
            this._data = new Uint32Array(this._data.buffer, 0, this._width * this._height * 4);
            this._positions = new Float32Array(this._positions.buffer, 0, 3 * newIndex);
            this._rotations = new Float32Array(this._rotations.buffer, 0, 4 * newIndex);
            this._scales = new Float32Array(this._scales.buffer, 0, 3 * newIndex);

            this.dispatchEvent(changeEvent);
        };

        this.saveToFile = (name: string) => {
            if (!document) return;

            const outputData = new Uint8Array(this._vertexCount * Scene.RowLength);

            const f_buffer = new Float32Array(outputData.buffer);
            const u_buffer = new Uint8Array(outputData.buffer);

            const data_c = new Uint8Array(this._data.buffer);

            for (let i = 0; i < this._vertexCount; i++) {
                f_buffer[8 * i + 0] = this._positions[3 * i + 0];
                f_buffer[8 * i + 1] = this._positions[3 * i + 1];
                f_buffer[8 * i + 2] = this._positions[3 * i + 2];

                u_buffer[32 * i + 24 + 0] = data_c[4 * (8 * i + 7) + 0];
                u_buffer[32 * i + 24 + 1] = data_c[4 * (8 * i + 7) + 1];
                u_buffer[32 * i + 24 + 2] = data_c[4 * (8 * i + 7) + 2];
                u_buffer[32 * i + 24 + 3] = data_c[4 * (8 * i + 7) + 3];

                f_buffer[8 * i + 3 + 0] = this._scales[3 * i + 0];
                f_buffer[8 * i + 3 + 1] = this._scales[3 * i + 1];
                f_buffer[8 * i + 3 + 2] = this._scales[3 * i + 2];

                u_buffer[32 * i + 28 + 0] = (this._rotations[4 * i + 0] * 128 + 128) & 0xff;
                u_buffer[32 * i + 28 + 1] = (this._rotations[4 * i + 1] * 128 + 128) & 0xff;
                u_buffer[32 * i + 28 + 2] = (this._rotations[4 * i + 2] * 128 + 128) & 0xff;
                u_buffer[32 * i + 28 + 3] = (this._rotations[4 * i + 3] * 128 + 128) & 0xff;
            }

            const blob = new Blob([outputData.buffer], { type: "application/octet-stream" });
            const link = document.createElement("a");
            link.download = name;
            link.href = URL.createObjectURL(blob);
            link.click();
        };

        this.updateColor = (camPos: Vector3) => {
            /*
                For each gaussian, update the color in scene.data buffer
                using spherical harmonics coefficients if provided
            */

        } 
    }

    get data() {
        return this._data;
    }

    get vertexCount() {
        return this._vertexCount;
    }

    get width() {
        return this._width;
    }

    get height() {
        return this._height;
    }

    get positions() {
        return this._positions;
    }

    get rotations() {
        return this._rotations;
    }

    get scales() {
        return this._scales;
    }

    get shs() {
        return this._shs;
    }

    get shs_rgb() {
        return this._shs_rgb;
    }

    get shHeight() {
        return this._shHeight;
    }

    get g0bands() {
        return this._g0bands;
    }

    set g0bands(nbGaussian0bands: number) {
        this._g0bands = nbGaussian0bands;
    }

    get bandsIndices() {
        return this._bandsIndices;
    }

    set bandsIndices(bIndices: Int32Array) {
        this._bandsIndices = bIndices;
    }

    set height(h : number) {
        this._height = h;
    };

    set data(d : Uint32Array) {
        this._data = d;
    }

    set vertexCount(vc : number) {
        this._vertexCount = vc;
    }

    set width(w : number) {
        this._width = w;
    }

    set positions(farr : Float32Array) {
        this._positions = farr;
    }

    set rotations(farr : Float32Array) {
        this._rotations = farr;
    }

    set scales(farr : Float32Array) {
        this._scales = farr;
    }

    set shs(uarr : Uint32Array) {
        this._shs = uarr;
    }

    set shs_rgb(uarrs : [Uint32Array, Uint32Array, Uint32Array]) {
        this._shs_rgb = uarrs;
    }

    set shHeight(h : number) {
        this._shHeight = h;
    }

}

export { Scene };
