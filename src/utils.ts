// https://stackoverflow.com/questions/35234551/javascript-converting-from-int16-to-float32
const int16ToFloat32 = (inputArray: Int16Array, startIndex: number, length: number) => {
    let output = new Float32Array(inputArray.length-startIndex);
    for (let i = startIndex; i < length; i++) {
        var int = inputArray[i];
        // If the high bit is on, then it is a negative number, and actually counts backwards.
        var float = (int >= 0x8000) ? -(0x10000 - int) / 0x8000 : int / 0x7FFF;
        output[i] = float;
    }
    return output;
};

const _floatView: Float32Array = new Float32Array(1);
const _int32View: Int32Array = new Int32Array(_floatView.buffer);

const floatToHalf = (float: number) => {
    _floatView[0] = float;
    const f = _int32View[0];

    const sign = (f >> 31) & 0x0001;
    const exp = (f >> 23) & 0x00ff;
    let frac = f & 0x007fffff;

    let newExp;
    if (exp == 0) {
        newExp = 0;
    } else if (exp < 113) {
        newExp = 0;
        frac |= 0x00800000;
        frac = frac >> (113 - exp);
        if (frac & 0x01000000) {
            newExp = 1;
            frac = 0;
        }
    } else if (exp < 142) {
        newExp = exp - 112;
    } else {
        newExp = 31;
        frac = 0;
    }

    return (sign << 15) | (newExp << 10) | (frac >> 13);
};

// x is on the 16 lsb, y on the 16 msb
const packHalf2x16 = (x: number, y: number) => {
    return (floatToHalf(x) | (floatToHalf(y) << 16)) >>> 0;
};


var pow = Math.pow;
function decodeFloat16 (inputArray: Int16Array, startIndex: number, length: number) {"use strict";
    let output = new Float32Array(inputArray.length-startIndex);
    for (let i = startIndex; i < length; i++) {

        var exponent = (inputArray[i] & 0x7C00) >> 10,
            fraction = inputArray[i] & 0x03FF;

        output[i] = (inputArray[i] >> 15 ? -1 : 1) * (
            exponent ?
            (
                exponent === 0x1F ?
                fraction ? NaN : Infinity :
                pow(2, exponent - 15) * (1 + fraction / 0x400)
            ) :
            6.103515625e-5 * (fraction / 0x400)
        );
    }

    return output;
};

export {packHalf2x16 as packHalf2x16, int16ToFloat32 as int16ToFloat32, decodeFloat16 as decodeFloat16};