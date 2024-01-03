import { Scene } from "../core/Scene";
import { Vector3 } from "../math/Vector3";
import { Quaternion } from "../math/Quaternion";
import { int16ToFloat32 } from "../utils";
import { decodeFloat16 } from "../utils";

class PLYLoader {
    static SH_C0 = 0.28209479177387814;
    static timestamp = 0;

    static async LoadAsync(
        url: string,
        scene: Scene,
        onProgress?: (progress: number) => void,
        format: string = "",
        useShs: boolean = false,
        quantized: boolean = false
    ): Promise<void> {
        const req = await fetch(url, {
            mode: "cors",
            credentials: "omit",
        });

        if (req.status != 200) {
            throw new Error(req.status + " Unable to load " + req.url);
        }

        const reader = req.body!.getReader();
        const contentLength = parseInt(req.headers.get("content-length") as string);
        const plyData = new Uint8Array(contentLength);

        let bytesRead = 0;
        this.timestamp = performance.now();

        // eslint-disable-next-line no-constant-condition
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            plyData.set(value, bytesRead);
            bytesRead += value.length;

            onProgress?.(bytesRead / contentLength);
        }
        const loadTime = performance.now() - this.timestamp;
        console.log(`File loaded in ${loadTime}ms.`);

        if (plyData[0] !== 112 || plyData[1] !== 108 || plyData[2] !== 121 || plyData[3] !== 10) {
            throw new Error("Invalid PLY file");
        }

        if(useShs) {
            let before = performance.now();
            // const rawData = this._ParseFullPLYBuffer(plyData.buffer, format);
            const rawData = this._ParseQPLYBuffer(plyData.buffer, format);
            let after = performance.now();

            console.log("PLY file parsing loading took " + (after - before) + " ms.");
            
            const data = new Uint8Array(rawData[0]);
            const shData = new Float32Array(rawData[1]);
            before = performance.now();
            scene.setData(data, shData);
            after = performance.now();

            console.log("setting the data in textures took " + (after - before) + " ms.");
        } else {
            const data = new Uint8Array(this._ParsePLYBuffer(plyData.buffer, format));
            scene.setData(data);
        }

    }

    static async LoadFromFileAsync(
        file: File,
        scene: Scene,
        onProgress?: (progress: number) => void,
        format: string = "",
        useShs: boolean = false,
        quantized: boolean = false
    ): Promise<void> {
        const reader = new FileReader();
        reader.onload = (e) => {
            if(useShs) {
                const loadTime = performance.now() - this.timestamp;
                console.log(`File loaded in ${loadTime}ms.`);
                let before = performance.now();

                let rawData;
                if(quantized) {
                    rawData = this._ParseQPLYBuffer(e.target!.result as ArrayBuffer, format);    

                    scene.bandsIndices = rawData[2]; //Indices of last gaussians having 0, 1 or 2 bands activated
                    // scene.g0bands= rawData[2]; //Nb of vertices having 0 bands.
                } else {
                    rawData = this._ParseFullPLYBuffer(e.target!.result as ArrayBuffer, format);
                }
                
                let after = performance.now();
                const data = new Uint8Array(rawData[0]);
                // const data = new Uint8Array(this._ParsePLYBuffer(e.target!.result as ArrayBuffer, format));
                const shData = new Float32Array(rawData[1]);

                console.log("PLY file parsing loading took " + (after - before) + " ms.");
                // console.log(data);

                before = performance.now();            
                // scene.setData(data);
                scene.setData(data, shData);
                after = performance.now();

                console.log("setting the data in textures took " + (after - before) + " ms.");
            } else {
                let before = performance.now();
                const data = new Uint8Array(this._ParsePLYBuffer(e.target!.result as ArrayBuffer, format));
                let after = performance.now();

                console.log("PLY file loading took " + (after - before) + " ms. (no shs)");

                scene.setData(data);
            }
        };

        reader.onloadstart = (e) => {
            this.timestamp = performance.now();
        }

        reader.onprogress = (e) => {
            onProgress?.(e.loaded / e.total);
        };
        reader.readAsArrayBuffer(file);
        await new Promise<void>((resolve) => {
            reader.onloadend = () => {
                resolve();
            };
        });
    }

    private static _ParsePLYBuffer(inputBuffer: ArrayBuffer, format: string): ArrayBuffer {
        type PlyProperty = {
            name: string;
            type: string;
            offset: number;
        };

        const ubuf = new Uint8Array(inputBuffer);
        const headerText = new TextDecoder().decode(ubuf.slice(0, 1024 * 10));
        const header_end = "end_header\n";
        const header_end_index = headerText.indexOf(header_end);
        if (header_end_index < 0) throw new Error("Unable to read .ply file header");

        const vertexCount = parseInt(/element vertex (\d+)\n/.exec(headerText)![1]);

        let rowOffset = 0;
        const offsets: Record<string, number> = {
            double: 8,
            int: 4,
            uint: 4,
            float: 4,
            short: 2,
            ushort: 2,
            uchar: 1,
        };

        const properties: PlyProperty[] = [];
        for (const prop of headerText
            .slice(0, header_end_index)
            .split("\n")
            .filter((k) => k.startsWith("property "))) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const [_p, type, name] = prop.split(" ");
            properties.push({ name, type, offset: rowOffset });
            if (!offsets[type]) throw new Error(`Unsupported property type: ${type}`);
            rowOffset += offsets[type];
        }

        const dataView = new DataView(inputBuffer, header_end_index + header_end.length);
        const buffer = new ArrayBuffer(Scene.RowLength * vertexCount);

        const q_polycam = Quaternion.FromEuler(new Vector3(Math.PI / 2, 0, 0));

        for (let i = 0; i < vertexCount; i++) {
            const position = new Float32Array(buffer, i * Scene.RowLength, 3);
            const scale = new Float32Array(buffer, i * Scene.RowLength + 12, 3);
            const rgba = new Uint8ClampedArray(buffer, i * Scene.RowLength + 24, 4);
            const rot = new Uint8ClampedArray(buffer, i * Scene.RowLength + 28, 4);

            let r0: number = 255;
            let r1: number = 0;
            let r2: number = 0;
            let r3: number = 0;

            properties.forEach((property) => {
                let value;
                switch (property.type) {
                    case "float":
                        value = dataView.getFloat32(property.offset + i * rowOffset, true);
                        break;
                    case "int":
                        value = dataView.getInt32(property.offset + i * rowOffset, true);
                        break;
                    default:
                        throw new Error(`Unsupported property type: ${property.type}`);
                }

                switch (property.name) {
                    case "x":
                        position[0] = value;
                        break;
                    case "y":
                        position[1] = value;
                        break;
                    case "z":
                        position[2] = value;
                        break;
                    case "scale_0":
                        scale[0] = Math.exp(value);
                        break;
                    case "scale_1":
                        scale[1] = Math.exp(value);
                        break;
                    case "scale_2":
                        scale[2] = Math.exp(value);
                        break;
                    case "red":
                        rgba[0] = value;
                        break;
                    case "green":
                        rgba[1] = value;
                        break;
                    case "blue":
                        rgba[2] = value;
                        break;
                    case "f_dc_0":
                        rgba[0] = (0.5 + this.SH_C0 * value) * 255;
                        break;
                    case "f_dc_1":
                        rgba[1] = (0.5 + this.SH_C0 * value) * 255;
                        break;
                    case "f_dc_2":
                        rgba[2] = (0.5 + this.SH_C0 * value) * 255;
                        break;
                    case "f_dc_3":
                        rgba[3] = (0.5 + this.SH_C0 * value) * 255;
                        break;
                    case "opacity":
                        rgba[3] = (1 / (1 + Math.exp(-value))) * 255;
                        break;
                    case "rot_0":
                        r0 = value;
                        break;
                    case "rot_1":
                        r1 = value;
                        break;
                    case "rot_2":
                        r2 = value;
                        break;
                    case "rot_3":
                        r3 = value;
                        break;
                }
            });

            let q = new Quaternion(r1, r2, r3, r0);

            switch (format) {
                case "polycam": {
                    const temp = position[1];
                    position[1] = -position[2];
                    position[2] = temp;
                    q = q_polycam.multiply(q);
                    break;
                }
                case "":
                    break;
                default:
                    throw new Error(`Unsupported format: ${format}`);
            }

            q = q.normalize();
            rot[0] = q.w * 128 + 128;
            rot[1] = q.x * 128 + 128;
            rot[2] = q.y * 128 + 128;
            rot[3] = q.z * 128 + 128;
        }

        return buffer;
    }

    //Must parse all 48 shs
    private static _ParseFullPLYBuffer(inputBuffer: ArrayBuffer, format: string): [ArrayBuffer, ArrayBuffer] {
        type PlyProperty = {
            name: string;
            type: string;
            offset: number;
        };

        let minSh = new Float32Array(48);
        let maxSh = new Float32Array(48);

        let minDc = new Float32Array(3);
        let maxDc = new Float32Array(3);

        const shRowLength = 4 * ((1*3) + (15*3)); //diffuse + 3 degrees of spherical harmonics in bytes

        const ubuf = new Uint8Array(inputBuffer);
        const headerText = new TextDecoder().decode(ubuf.slice(0, 1024 * 10));
        const header_end = "end_header\n";
        const header_end_index = headerText.indexOf(header_end);
        if (header_end_index < 0) throw new Error("Unable to read .ply file header");

        const vertexCount = parseInt(/element vertex (\d+)\n/.exec(headerText)![1]);

        let rowOffset = 0;
        const offsets: Record<string, number> = {
            double: 8,
            int: 4,
            uint: 4,
            float: 4,
            short: 2,
            ushort: 2,
            uchar: 1,
        };

        const properties: PlyProperty[] = [];
        for (const prop of headerText
            .slice(0, header_end_index)
            .split("\n")
            .filter((k) => k.startsWith("property "))) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const [_p, type, name] = prop.split(" ");
            properties.push({ name, type, offset: rowOffset });
            if (!offsets[type]) throw new Error(`Unsupported property type: ${type}`);
            rowOffset += offsets[type];
        }

        const dataView = new DataView(inputBuffer, header_end_index + header_end.length);
        const dataBuffer = new ArrayBuffer(Scene.RowLength * vertexCount);
        const shsBuffer = new ArrayBuffer(shRowLength * vertexCount);

        const q_polycam = Quaternion.FromEuler(new Vector3(Math.PI / 2, 0, 0));

        for (let i = 0; i < vertexCount; i++) {
            const position = new Float32Array(dataBuffer, i * Scene.RowLength, 3);
            const scale = new Float32Array(dataBuffer, i * Scene.RowLength + 12, 3);
            const rgba = new Uint8ClampedArray(dataBuffer, i * Scene.RowLength + 24, 4);
            const rot = new Uint8ClampedArray(dataBuffer, i * Scene.RowLength + 28, 4);
            const sh = new Float32Array(shsBuffer, i*shRowLength, 48);

            let r0: number = 255;
            let r1: number = 0;
            let r2: number = 0;
            let r3: number = 0; 

            properties.forEach((property) => {
                let value;
                switch (property.type) {
                    case "float":
                        value = dataView.getFloat32(property.offset + i * rowOffset, true);
                        break;
                    case "int":
                        value = dataView.getInt32(property.offset + i * rowOffset, true);
                        break;
                    default:
                        throw new Error(`Unsupported property type: ${property.type}`);
                }

                if(property.name.startsWith("f_rest")) {
                    //spherical harmonics coefficients
                    let n = parseInt(property.name.split("_").slice(-1)[0])
                    const index = 3 + ((n % 15)*3 + Math.floor(n / 15));
                    sh[index] = value;

                } else {

                    switch (property.name) {
                        case "x":
                            position[0] = value;
                            break;
                        case "y":
                            position[1] = value;
                            break;
                        case "z":
                            position[2] = value;
                            break;
                        case "scale_0":
                            scale[0] = Math.exp(value);
                            break;
                        case "scale_1":
                            scale[1] = Math.exp(value);
                            break;
                        case "scale_2":
                            scale[2] = Math.exp(value);
                            break;
                        case "red":
                            rgba[0] = value;
                            break;
                        case "green":
                            rgba[1] = value;
                            break;
                        case "blue":
                            rgba[2] = value;
                            break;
                        case "f_dc_0":
                            rgba[0] = (0.5 + this.SH_C0 * value) * 255;
                            sh[0] = value;
                            minDc[0] = value < minDc[0] ? value : minDc[0]; 
                            maxDc[0] = value > maxDc[0] ? value : maxDc[0]; 
                            break;
                            case "f_dc_1":
                            rgba[1] = (0.5 + this.SH_C0 * value) * 255;
                            sh[1] = value;
                            minDc[1] = value < minDc[1] ? value : minDc[1];
                            maxDc[1] = value > maxDc[1] ? value : maxDc[1];
                            break;
                            case "f_dc_2":
                            rgba[2] = (0.5 + this.SH_C0 * value) * 255;
                            sh[2] = value;
                            minDc[2] = value < minDc[2] ? value : minDc[2];
                            maxDc[2] = value > maxDc[2] ? value : maxDc[2];
                            break;
                        case "f_dc_3":
                            rgba[3] = (0.5 + this.SH_C0 * value) * 255;
                            break;
                        case "opacity":
                            rgba[3] = (1 / (1 + Math.exp(-value))) * 255;
                            break;
                        case "rot_0":
                            r0 = value;
                            break;
                        case "rot_1":
                            r1 = value;
                            break;
                        case "rot_2":
                            r2 = value;
                            break;
                        case "rot_3":
                            r3 = value;
                            break;
                    }
                }

            });

            let q = new Quaternion(r1, r2, r3, r0);

            switch (format) {
                case "polycam": {
                    const temp = position[1];
                    position[1] = -position[2];
                    position[2] = temp;
                    q = q_polycam.multiply(q);
                    break;
                }
                case "":
                    break;
                default:
                    throw new Error(`Unsupported format: ${format}`);
            }

            q = q.normalize();
            rot[0] = q.w * 128 + 128;
            rot[1] = q.x * 128 + 128;
            rot[2] = q.y * 128 + 128;
            rot[3] = q.z * 128 + 128;
        }

        return [dataBuffer, shsBuffer];
    }

    // parse quantized ply
    private static _ParseQPLYBuffer(inputBuffer: ArrayBuffer, format: string): [ArrayBuffer, ArrayBuffer, Int32Array] {
        type PlyProperty = {
            name: string;
            type: string;
            offset: number;
        };

        type CodeBook = {
            name: string,
            data: Int16Array
        };

        const ubuf = new Uint8Array(inputBuffer);
        const headerText = new TextDecoder().decode(ubuf.slice(0, 1024 * 10));
        const header_end = "end_header\n";
        const header_end_index = headerText.indexOf(header_end);
        const start_codebook = "element codebook_centers 256\n";
        const start_codebook_index = headerText.indexOf(start_codebook);

        if (header_end_index < 0) throw new Error("Unable to read .ply file header");

        let vertexCounts : Array<number> = [];
        let pcIndices : Array<number> = [];
        
        headerText.match(/element vertex_(\d+) (\d+)/g)?.forEach((el) => {
            vertexCounts.push(parseInt(el.split(" ")[2]));
            pcIndices.push(headerText.indexOf(el))
        });

        let extentsLut : Array<Array<number>> = [
            [0, pcIndices[1]],
            [pcIndices[1], pcIndices[2]],
            [pcIndices[2], pcIndices[3]],
            [pcIndices[3], start_codebook_index]
        ];
        
        console.log(vertexCounts);
        
        const offsets: Record<string, number> = {
            double: 8,
            int: 4,
            uint: 4,
            float: 4,
            short: 2,
            ushort: 2,
            uchar: 1,
        };

        // Fill data structures and compute the data offset in bytes (to know exactly where codebooks starts)
        let dataByteSizeRead = 0;
        const properties : Array<PlyProperty[]> = [];
        let rowOffsetsRead = [];
        let totalVertexCount = 0;
        let propIndex = [];

        for(let i = 0; i < 4; i ++) {
            const vertexCount : number = vertexCounts[i];
            const start : number = extentsLut[i][0];
            const end : number  = extentsLut[i][1]; 
            console.log(`${vertexCount} Vertices.`)
            totalVertexCount += vertexCount;

            let rowOffset = 0;
            const vertexProperties : PlyProperty[] = [];
            let ind = 0;
            let props : any = {};

            for (const prop of headerText
                .slice(start, end)
                .split("\n")
                .filter((k) => k.startsWith("property "))) {

                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const [_p, type, name] = prop.split(" ");
                vertexProperties.push({ name, type, offset: rowOffset });
                if (!offsets[type]) throw new Error(`Unsupported property type: ${type}`);
                rowOffset += offsets[type];
                props[name] = ind;
                ind ++;
            }
            
            properties.push(vertexProperties);
            rowOffsetsRead.push(rowOffset);
            propIndex.push(props);

            dataByteSizeRead += vertexCount*rowOffset;
        }
        console.log("PROPERTIES ")
        console.log(properties);

        console.log("PROPERTIES INDICES: ");
        console.log(propIndex);

        // fill codebooks
        //cb contains each codebooks as int16Array(256)
        let cbIndex : any = {};
        const cb : CodeBook[] = [];
        let ind = 0;
        for (const prop of headerText
            .slice(start_codebook_index, header_end_index)
            .split("\n")
            .filter((k) => k.startsWith("property "))) {
                        
            const [_p, type, name] = prop.split(" ");
            cb.push({name, data: new Int16Array(256)});
            cbIndex[name] = ind;
            ind ++;
        }

        // console.log(cb);

        console.log("CB INDEX OBJECT: ");
        console.log(cbIndex);

                    
        console.log(dataByteSizeRead + " bytes before codebooks.");
        const nbCodeBooks = cb.length;
        const cbDataView = new DataView(inputBuffer, dataByteSizeRead + header_end_index + header_end.length, nbCodeBooks * 2 * 256);

        for(let i = 0; i < 256; i ++) {
           for(let j = 0; j < nbCodeBooks; j ++) {
                cb[j].data[i] = cbDataView.getInt16((i*nbCodeBooks*2) + (j*2), true);
                // cb[j].data[i] = decodeFloat16(cbDataView.getInt16((i*nbCodeBooks*2) + (j*2), true));

            }
        }

        console.log("CODEBOOKS: ");
        console.log(cb);

        const shRowLength = 4 * ((1*3) + (15*3)); //diffuse + 3 degrees of spherical harmonics in bytes
        const valDataView = new DataView(inputBuffer, header_end_index + header_end.length, dataByteSizeRead);
        const dataBuffer = new ArrayBuffer(Scene.RowLength * totalVertexCount);
        const shsBuffer = new ArrayBuffer(shRowLength * (vertexCounts[1] + vertexCounts[2] + vertexCounts[3]));

        console.log(`sh texture of size ${vertexCounts[3]} * ${shRowLength}`);

        //main loop
        let shLength = 0;
        let writeOffset = 0;
        let readOffset = 0;
        let shOffset = 0;

        const shStrideLut = [3, 8, 15];
        let shStride = 0;
        for(let i = 0; i < 4; i ++) {
            const vertexCount : number  = vertexCounts[i];
            const prop : PlyProperty[] = properties[i];
            // const rowOffsetWrite = rowOffsetsWrite[i];
            const rowOffsetRead = rowOffsetsRead[i];
            const pIndices = propIndex[i];

            if(i > 0){
                shLength = shRowLength;
                shStride = shStrideLut[i-1];
            } 

            const sh_prop = prop.filter((p) => p.name.startsWith("f_rest"));

            for(let v = 0; v < vertexCount; v ++) {
                const position = new Float32Array(dataBuffer, writeOffset + v * Scene.RowLength, 3);
                const scale = new Float32Array(dataBuffer, writeOffset + v * Scene.RowLength + 12, 3);
                const rgba = new Uint8ClampedArray(dataBuffer, writeOffset + v * Scene.RowLength + 24, 4);
                const rot = new Uint8ClampedArray(dataBuffer, writeOffset + v * Scene.RowLength + 28, 4);
                const sh = new Float32Array(shsBuffer, shOffset + v * shLength, shLength/4);

                let r = [255, 0, 0, 0];
                
                // POSITION
                const pX = prop[pIndices['x']];
                let h = valDataView.getInt16(readOffset + pX.offset + v * rowOffsetRead, true);
                position[0] = decodeFloat16(new Int16Array([h]), 0, 1)[0];
                
                const pY = prop[pIndices['y']];
                h = valDataView.getInt16(readOffset + pY.offset + v * rowOffsetRead, true);
                position[1] = decodeFloat16(new Int16Array([h]), 0, 1)[0];

                const pZ = prop[pIndices['z']];
                h = valDataView.getInt16(readOffset + pZ.offset + v * rowOffsetRead, true);
                position[2] = decodeFloat16(new Int16Array([h]), 0, 1)[0];

                let index;
                let indexInCb;
                let value;

                // SCALING
                for(let j = 0; j < 3; j ++) {
                    const pScale = prop[pIndices[`scale_${j}`]];
                    index = valDataView.getUint8(readOffset + pScale.offset + v * rowOffsetRead);
                    indexInCb = cbIndex["scaling"];
                    h = cb[indexInCb].data[index];
                    value = decodeFloat16(new Int16Array([h]), 0, 1)[0];
                    scale[j] = Math.exp(value);
                }

                //ROTATION
                const pRotRe = prop[pIndices["rot_0"]];
                index = valDataView.getUint8(readOffset + pRotRe.offset + v * rowOffsetRead);
                indexInCb = cbIndex["rotation_re"];
                h = cb[indexInCb].data[index];
                r[0] = decodeFloat16(new Int16Array([h]), 0, 1)[0];

                for(let j = 1; j < 4; j ++) {
                    const pRot = prop[pIndices[`rot_${j}`]];
                    index = valDataView.getUint8(readOffset + pRot.offset + v * rowOffsetRead);
                    indexInCb = cbIndex["rotation_im"];
                    h = cb[indexInCb].data[index];
                    r[j] = decodeFloat16(new Int16Array([h]), 0, 1)[0];
                }

                // DIFFUSE COMPONENT (RGBA + FILL SH COEFFS IF LAST POINTCLOUD)
                for(let j = 0; j < 3; j ++) {
                    const pCol = prop[pIndices[`f_dc_${j}`]];
                    index = valDataView.getUint8(readOffset + pCol.offset + v * rowOffsetRead);
                    indexInCb = cbIndex["features_dc"];
                    h = cb[indexInCb].data[index];
                    value = decodeFloat16(new Int16Array([h]), 0, 1)[0];
                    rgba[j] = (0.5 + this.SH_C0* value) * 255;
                    
                    if(i > 0) sh[j] = value;
                }

                const pOpacity =  prop[pIndices["opacity"]];
                index = valDataView.getUint8(readOffset + pOpacity.offset + v * rowOffsetRead);
                indexInCb = cbIndex["opacity"];
                h = cb[indexInCb].data[index];
                value = decodeFloat16(new Int16Array([h]), 0, 1)[0];
                rgba[3] = (1 / (1 + Math.exp(-value))) * 255;

                //SPHERICAL HARMONICS
                for(const p of sh_prop) {
                    const n44 = parseInt(p.name.split("_").slice(-1)[0]);
                    const n14 = n44 % shStride;
                    
                    index = valDataView.getUint8(readOffset + p.offset + v * rowOffsetRead);

                    indexInCb = cbIndex[`features_rest_${n14}`];
                    h = cb[indexInCb].data[index];

                    const shIndex =  3 + ((n44 % shStride)*3 + Math.floor(n44 / shStride));
                    value = decodeFloat16(new Int16Array([h]), 0, 1)[0];

                    // if(v == 0) testArr[3+n44] = coeff;
                    // console.log(``)
                    sh[shIndex] = value;
                }


                    let q = new Quaternion(r[1], r[2], r[3], r[0]);

                    q = q.normalize();
                    rot[0] = q.w * 128 + 128;
                    rot[1] = q.x * 128 + 128;
                    rot[2] = q.y * 128 + 128;
                    rot[3] = q.z * 128 + 128;

                    // console.log(`vertex ${v} Scales ${scale}`);
                    // console.log(`vertex ${v} Pos ${position}`);
                    // console.log(`vertex ${v} rotation ${rot}`);
                    // console.log(`vertex ${v} opacity ${rgba[3]}`);
                }
                
            writeOffset += vertexCount * Scene.RowLength;
            readOffset += vertexCount * rowOffsetRead;
            
            if(i > 0) shOffset += vertexCount * shLength;


            // console.log(testArr);
        }


        // INDi: INDICE OF LAST GAUSSIAN HAVING i BANDS ACTIVATED
        const ind0 = vertexCounts[0]-1;
        const ind1 = ind0 + vertexCounts[1];
        const ind2 = ind1 + vertexCounts[2];

        return [dataBuffer, shsBuffer, new Int32Array([ind0, ind1, ind2])];
    }
}

export { PLYLoader };
