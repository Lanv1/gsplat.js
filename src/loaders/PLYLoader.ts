import { Scene } from "../core/Scene";
import { Matrix3 } from "../math/Matrix3";
import { Quaternion } from "../math/Quaternion";
import { Vector3 } from "../math/Vector3";
import { int16ToFloat32 } from "../utils";
import { decodeFloat16 } from "../utils";
import { resolve } from "path";
import { rejects } from "assert";
import { packHalf2x16 } from "../utils";
import { EventDispatcher } from "../core/EventDispatcher";


type PlyProperty = {
    name: string;
    type: string;
    offset: number;
};

type PlyHeader = {
    properties: PlyProperty[],
    size: number,
    vertexCount: number
};

const  SH_C0 = 0.28209479177387814;
class PLYLoader {
    static timestamp = 0;
    static changeEvent = { type: "change" } as Event;

    static async LoadAsync(
        url: string,
        scene: Scene,
        onProgress?: (progress: number, loadingDone?: boolean) => void,
        format: string = "",
        useShs: boolean = false,
        quantized: boolean = false
    ): Promise<void> {
        const req = await fetch(url, {
            mode: "no-cors",
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
        
        onProgress?.(1, true);
        await new Promise(resolve => setTimeout(resolve, 100));   //sketchy but only way i found to let html update between loading and parsing

        if (plyData[0] !== 112 || plyData[1] !== 108 || plyData[2] !== 121 || plyData[3] !== 10) {
            throw new Error("Invalid PLY file");
        }

        if(useShs) {
            // const rawData = this._ParseFullPLYBuffer(plyData.buffer, format);


            let before = performance.now();

            let rawData;
            if(quantized) {
                rawData = this._ParseQPLYBuffer(plyData.buffer, format);    
                scene.bandsIndices = rawData[2]; //Indices of last gaussians having 0, 1 or 2 bands activated
                // scene.g0bands= rawData[2]; //Nb of vertices having 0 bands.
            } else {
                const plyHeader = this._parsePLYHeader(plyData.buffer, format);
                rawData = this._ParseFullPLYBufferFast(plyHeader, plyData.buffer);
            }
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

    // Only the loading of the file as a promise
    private static async loadFileDataAsync(
        file: File,
        onProgress?: (progress: number, loadingDone?: boolean) => void,
    ): Promise<ArrayBuffer> {

        const reader = new FileReader();
        reader.onloadstart = (e) => {
            PLYLoader.timestamp = performance.now();
        }

        reader.onprogress = (e) => {
            onProgress?.(e.loaded / e.total, false);
        };
        
        reader.readAsArrayBuffer(file);
        const dataPromise = await new Promise<ArrayBuffer>((resolve) => {
            reader.onload = (e) => {

                const loadTime = performance.now() - PLYLoader.timestamp;
                console.log(`File loaded in ${loadTime}ms.`);
                onProgress?.(1, true);
                
                resolve(e.target!.result as ArrayBuffer);
            };
        });

        onProgress?.(1, true);
        await new Promise(resolve => setTimeout(resolve, 20));   //sketchy but only way i found to let html update between loading and parsing

        return dataPromise;
    }

    // Directly set data in the texture while parsing the file (no intermediate array construction) hopefully faster than before -> actually not faster 
    private static _ParsePLYAndFillData(scene: Scene,  header: PlyHeader, inputBuffer: ArrayBuffer, format: string): void {

        const shRowLength = 4 * ((1*3) + (15*3)); //diffuse + 3 degrees of spherical harmonics in bytes

        const dataView = new DataView(inputBuffer, header.size);
        const input = new Float32Array(inputBuffer, header.size);
        const dataBuffer = new ArrayBuffer(Scene.RowLength * header.vertexCount);
        const shsBuffer = new ArrayBuffer(shRowLength * header.vertexCount);

        const shSize = header.vertexCount;
            
        // let shSize;
        // if(this.bandsIndices[0] > 0) {
        //     shSize = this.vertexCount - (this.bandsIndices[0]+1);
        // } else {
        //     shSize = this.vertexCount;
        // }
        


        // Convert properties as a dictionnary -> faster
        const prop: Record<string, PlyProperty> = header.properties.reduce((acc: Record<string, PlyProperty>, item: PlyProperty) => {
            acc[item.name] = item;
            return acc;
        }, {});
        
        // console.log(prop);

        // const rowOffset = header.properties.reduce((accumulator, currentValue) => { return accumulator + currentValue.offset}, 0);
        const rowOffset = header.properties[header.properties.length-1].offset +4
        console.log("ROW OFFSET " + rowOffset)

        let r0: number = 255;
        let r1: number = 0;
        let r2: number = 0;
        let r3: number = 0; 
        let q : Quaternion;


        // SCENE DATA (Texture data)
        // console.log(`${shSize} gaussians with 1,2 or 3 bands.`);
        scene.vertexCount = header.vertexCount;
        scene.height = Math.ceil((2 * scene.vertexCount) / scene.width);
        scene.data = new Uint32Array(scene.width * scene.height * 4);
        scene.positions = new Float32Array(3 * scene.vertexCount);
        scene.rotations = new Float32Array(4 * scene.vertexCount);
        scene.scales = new Float32Array(3 * scene.vertexCount);

        // if(typeof shs != 'undefined') {
        scene.shHeight = Math.ceil((2 * shSize) / scene.width);
            //padding added
            // this._shs = new Uint32Array(this._width* this._shHeight * 4);

            // no pad needed: 16F32 -> 8F32 using half16 packing so each sh texture is the same size as data texture !
        scene.shs_rgb = [
            new Uint32Array(scene.width * scene.shHeight * 4),
            new Uint32Array(scene.width * scene.shHeight * 4),
            new Uint32Array(scene.width * scene.shHeight * 4)
        ];
        // }

        const f_buffer = new Float32Array(inputBuffer, header.size);
        const u_buffer = new Uint8Array(inputBuffer, header.size);

        const data_c = new Uint8Array(scene.data.buffer);
        const data_f = new Float32Array(scene.data.buffer);
        
        const shs_f = new Float32Array(scene.shs.buffer);

        for (let i = 0; i < header.vertexCount; i++) {
            // const position = new Float32Array(dataBuffer, i * Scene.RowLength, 3);
            // const scale = new Float32Array(dataBuffer, i * Scene.RowLength + 12, 3);
            const rgba = new Uint8ClampedArray(dataBuffer, i * Scene.RowLength + 24, 4);
            // const rot = new Uint8ClampedArray(dataBuffer, i * Scene.RowLength + 28, 4);
            // const sh = new Float32Array(shsBuffer, i*shRowLength, 48);
            const floatOffset = i * (rowOffset / 4);

            // position.set([
            //     input[(prop['x'].offset / 4) + floatOffset],
            //     input[(prop['y'].offset / 4) + floatOffset],
            //     input[(prop['z'].offset / 4) + floatOffset]
            // ], 0);

            //SCENE POSITIONS
            data_f[8 * i + 0] = f_buffer[(prop['x'].offset / 4) + floatOffset];
            data_f[8 * i + 1] = f_buffer[(prop['y'].offset / 4) + floatOffset];
            data_f[8 * i + 2] = f_buffer[(prop['z'].offset / 4) + floatOffset];
            
            scene.positions[3 * i + 0] = data_f[8 * i + 0];
            scene.positions[3 * i + 1] = data_f[8 * i + 1];
            scene.positions[3 * i + 2] = data_f[8 * i + 2];


            //SCENE SCALES
            scene.scales[3 * i + 0] = Math.exp( input[(prop['scale_0'].offset / 4) + floatOffset]);
            scene.scales[3 * i + 1] = Math.exp( input[(prop['scale_1'].offset / 4) + floatOffset]);
            scene.scales[3 * i + 2] = Math.exp( input[(prop['scale_2'].offset / 4) + floatOffset]);

            //SCENE RGBA
            data_c[4 * (8 * i + 7) + 0] = (0.5 + SH_C0 *  input[(prop['f_dc_0'].offset / 4) + floatOffset] * 255);
            data_c[4 * (8 * i + 7) + 1] = (0.5 + SH_C0 *  input[(prop['f_dc_1'].offset / 4) + floatOffset] * 255);
            data_c[4 * (8 * i + 7) + 2] = (0.5 + SH_C0 *  input[(prop['f_dc_2'].offset / 4) + floatOffset] * 255);
            data_c[4 * (8 * i + 7) + 3] = (0.5 + SH_C0 *  input[(prop['opacity'].offset / 4) + floatOffset] * 255);

            // rgba.set([
            //     (0.5 + SH_C0 *  input[(prop['f_dc_0'].offset / 4) + floatOffset] * 255),
            //     (0.5 + SH_C0 *  input[(prop['f_dc_1'].offset / 4) + floatOffset] * 255),
            //     (0.5 + SH_C0 *  input[(prop['f_dc_2'].offset / 4) + floatOffset] * 255),
            //     (1 / (1 + Math.exp(-input[(prop['opacity'].offset / 4) + floatOffset])) * 255)
            // ], 0);

            r0 =  input[(prop['rot_0'].offset/4) + floatOffset];
            r1 =  input[(prop['rot_1'].offset/4) + floatOffset];
            r2 =  input[(prop['rot_2'].offset/4) + floatOffset];
            r3 =  input[(prop['rot_3'].offset/4) + floatOffset];

            q = new Quaternion(r1, r2, r3, r0);

            q = q.normalize();

            scene.rotations[4 * i + 0] = q.w;
            scene.rotations[4 * i + 1] = q.x;
            scene.rotations[4 * i + 2] = q.y;
            scene.rotations[4 * i + 3] = q.z;

            const rot = Matrix3.RotationFromQuaternion(
                new Quaternion(
                    scene.rotations[4 * i + 1],
                    scene.rotations[4 * i + 2],
                    scene.rotations[4 * i + 3],
                    -scene.rotations[4 * i + 0],
                ),
            );

            const scale = Matrix3.Diagonal(
                new Vector3(scene.scales[3 * i + 0], scene.scales[3 * i + 1], scene.scales[3 * i + 2]),
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

            // SCENE ROTATION (COV MATRIX)
            scene.data[8 * i + 4] = packHalf2x16(4 * sigma[0], 4 * sigma[1]);
            scene.data[8 * i + 5] = packHalf2x16(4 * sigma[2], 4 * sigma[3]);
            scene.data[8 * i + 6] = packHalf2x16(4 * sigma[4], 4 * sigma[5]);

            //Scene SHS:
                // BETTER: pack them in 3 textures (one per component)       
             
            scene.shs_rgb[0][8*i] = packHalf2x16(
                input[(prop[`f_dc_0`].offset / 4) + floatOffset],
                input[(prop[`f_rest_0`].offset / 4) + floatOffset]
            );

            scene.shs_rgb[1][8*i] = packHalf2x16(
                input[(prop[`f_dc_1`].offset / 4) + floatOffset],
                input[(prop[`f_rest_15`].offset / 4) + floatOffset]
            );

            scene.shs_rgb[2][8*i] = packHalf2x16(
                input[(prop[`f_dc_2`].offset / 4) + floatOffset],
                input[(prop[`f_rest_30`].offset / 4) + floatOffset]
            );

            let ind = 1;
            for(let j = 1; j < 8; j ++) {
                scene.shs_rgb[0][8*i + j] = packHalf2x16(
                    input[(prop[`f_rest_${ind}`].offset / 4) + floatOffset],
                    input[(prop[`f_rest_${ind + 1}`].offset / 4) + floatOffset]
                );

                scene.shs_rgb[1][8*i + j] = packHalf2x16(
                    input[(prop[`f_rest_${ind + 15}`].offset / 4) + floatOffset],
                    input[(prop[`f_rest_${ind + 16}`].offset / 4) + floatOffset]
                );

                scene.shs_rgb[2][8*i + j] = packHalf2x16(
                    input[(prop[`f_rest_${ind + 30}`].offset / 4) + floatOffset],
                    input[(prop[`f_rest_${ind + 31}`].offset / 4) + floatOffset]
                );
                ind +=2;
            }

        }

        scene.dispatchEvent(PLYLoader.changeEvent);
    }

    static async LoadFromFileAsync(
        file: File,
        scene: Scene,
        onProgress?: (progress: number, loadingDone?: boolean) => void,
        format: string = "",
        useShs: boolean = false,
        quantized: boolean = false
    ): Promise<void> {

        await PLYLoader.loadFileDataAsync(file, onProgress)
        .then((rawBuffer: ArrayBuffer) => {
            if(useShs) {
                // const rawData = this._ParseFullPLYBuffer(plyData.buffer, format);
                let before = performance.now();

                let rawData;
                if(quantized) {
                    rawData = this._ParseQPLYBuffer(rawBuffer, format);    
                    scene.bandsIndices = rawData[2]; //Indices of last gaussians having 0, 1 or 2 bands activated
                    // scene.g0bands= rawData[2]; //Nb of vertices having 0 bands.
                } else {
                    const plyHeader = this._parsePLYHeader(rawBuffer, format);

                    console.log("PLY HEADER parsed: ");
                    console.log(plyHeader);

                    rawData = this._ParseFullPLYBufferFast(plyHeader, rawBuffer);
                }
                let after = performance.now();
    
                console.log("PLY file parsing took " + (after - before) + " ms.");
    
                const data = new Uint8Array(rawData[0]);
                const shData = new Float32Array(rawData[1]);
                
                before = performance.now();
                scene.setData(data, shData);
                after = performance.now();
    
                console.log("setting the data in textures took " + (after - before) + " ms.");
            } else {
                const data = new Uint8Array(this._ParsePLYBuffer(rawBuffer, format));
                scene.setData(data);
            }
        });

      
    }

    private static _ParsePLYBuffer(inputBuffer: ArrayBuffer, format: string): ArrayBuffer {
        // type PlyProperty = {
        //     name: string;
        //     type: string;
        //     offset: number;
        // };

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
                        rgba[0] = (0.5 + SH_C0 * value) * 255;
                        break;
                    case "f_dc_1":
                        rgba[1] = (0.5 + SH_C0 * value) * 255;
                        break;
                    case "f_dc_2":
                        rgba[2] = (0.5 + SH_C0 * value) * 255;
                        break;
                    case "f_dc_3":
                        rgba[3] = (0.5 + SH_C0 * value) * 255;
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

    // Reads properties and size of header + vertexCount only
    private static _parsePLYHeader(inputBuffer: ArrayBuffer, format: string): PlyHeader {
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

        // let plyHeader : PlyHeader = {properties: properties, size: (header_end_index + header_end.length), vertexCount: vertexCount};
        return {properties: properties, size: (header_end_index + header_end.length), vertexCount: vertexCount};
    }


    private static _ParseFullPLYBufferFast(
        header:PlyHeader, inputBuffer: ArrayBuffer,
        onProgress? : (progress: number, loadingDone?: boolean) => void): [ArrayBuffer, ArrayBuffer] {

        const shRowLength = 4 * ((1*3) + (15*3)); //diffuse + 3 degrees of spherical harmonics in bytes

        const dataView = new DataView(inputBuffer, header.size);

        // const input = new Float32Array(inputBuffer, header.size);   // since we're treating everything as a float32 there is no need for a dataview
        const dataBuffer = new ArrayBuffer(Scene.RowLength * header.vertexCount);
        const shsBuffer = new ArrayBuffer(shRowLength * header.vertexCount);

        const prop: Record<string, PlyProperty> = header.properties.reduce((acc: Record<string, PlyProperty>, item: PlyProperty) => {
            acc[item.name] = item;
            return acc;
        }, {});
        
        // console.log(prop);

        const rowOffset = header.properties[header.properties.length-1].offset +4

        let r0: number = 255;
        let r1: number = 0;
        let r2: number = 0;
        let r3: number = 0; 
        let q : Quaternion;


        for (let i = 0; i < header.vertexCount; i++) {
            const position = new Float32Array(dataBuffer, i * Scene.RowLength, 3);
            const scale = new Float32Array(dataBuffer, i * Scene.RowLength + 12, 3);
            const rgba = new Uint8ClampedArray(dataBuffer, i * Scene.RowLength + 24, 4);
            const rot = new Uint8ClampedArray(dataBuffer, i * Scene.RowLength + 28, 4);
            const sh = new Float32Array(shsBuffer, i*shRowLength, 48);
            const floatOffset = i * (rowOffset / 4);

            position.set([
                dataView.getFloat32(prop['x'].offset + i*rowOffset, true),
                dataView.getFloat32(prop['y'].offset + i*rowOffset, true),
                dataView.getFloat32(prop['z'].offset + i*rowOffset, true)
            ], 0);

            scale.set([
                Math.exp(dataView.getFloat32(prop['scale_0'].offset + i*rowOffset, true)),
                Math.exp(dataView.getFloat32(prop['scale_1'].offset + i*rowOffset, true)),
                Math.exp(dataView.getFloat32(prop['scale_2'].offset + i*rowOffset, true))
            ], 0);

            rgba.set([
                (0.5 + SH_C0 *  dataView.getFloat32(prop['f_dc_0'].offset + i*rowOffset, true) * 255),
                (0.5 + SH_C0 *  dataView.getFloat32(prop['f_dc_1'].offset + i*rowOffset, true) * 255),
                (0.5 + SH_C0 *  dataView.getFloat32(prop['f_dc_2'].offset + i*rowOffset, true) * 255),
                (1 / (1 + Math.exp(-dataView.getFloat32(prop['opacity'].offset + i *rowOffset, true))) * 255)
            ], 0);

            r0 =  dataView.getFloat32(prop['rot_0'].offset + i*rowOffset, true);
            r1 =  dataView.getFloat32(prop['rot_1'].offset + i*rowOffset, true);
            r2 =  dataView.getFloat32(prop['rot_2'].offset + i*rowOffset, true);
            r3 =  dataView.getFloat32(prop['rot_3'].offset + i*rowOffset, true);

            q = new Quaternion(r1, r2, r3, r0);

            q = q.normalize();

            rot.set([
                q.w * 128 + 128,
                q.x * 128 + 128,
                q.y * 128 + 128,
                q.z * 128 + 128,
            ], 0);

            sh.set([
                dataView.getFloat32(prop['f_dc_0'].offset+ i*rowOffset, true),
                dataView.getFloat32(prop['f_dc_1'].offset+ i*rowOffset, true),
                dataView.getFloat32(prop['f_dc_2'].offset+ i*rowOffset, true)
            ], 0);

            sh.set([
                dataView.getFloat32(prop[`f_rest_0`].offset + i*rowOffset, true),
                dataView.getFloat32(prop[`f_rest_15`].offset +i*rowOffset, true),
                dataView.getFloat32(prop[`f_rest_30`].offset +i*rowOffset, true),
                dataView.getFloat32(prop[`f_rest_1`].offset + i*rowOffset, true),
                dataView.getFloat32(prop[`f_rest_16`].offset +i*rowOffset, true),
                dataView.getFloat32(prop[`f_rest_31`].offset +i*rowOffset, true),
                dataView.getFloat32(prop[`f_rest_2`].offset + i*rowOffset, true),
                dataView.getFloat32(prop[`f_rest_17`].offset +i*rowOffset, true),
                dataView.getFloat32(prop[`f_rest_32`].offset +i*rowOffset, true),
                dataView.getFloat32(prop[`f_rest_3`].offset + i*rowOffset, true),
                dataView.getFloat32(prop[`f_rest_18`].offset +i*rowOffset, true),
                dataView.getFloat32(prop[`f_rest_33`].offset +i*rowOffset, true),
                dataView.getFloat32(prop[`f_rest_4`].offset + i*rowOffset, true),
                dataView.getFloat32(prop[`f_rest_19`].offset +i*rowOffset, true),
                dataView.getFloat32(prop[`f_rest_34`].offset +i*rowOffset, true),
                dataView.getFloat32(prop[`f_rest_5`].offset + i*rowOffset, true),
                dataView.getFloat32(prop[`f_rest_20`].offset +i*rowOffset, true),
                dataView.getFloat32(prop[`f_rest_35`].offset +i*rowOffset, true),
                dataView.getFloat32(prop[`f_rest_6`].offset + i*rowOffset, true),
                dataView.getFloat32(prop[`f_rest_21`].offset +i*rowOffset, true),
                dataView.getFloat32(prop[`f_rest_36`].offset +i*rowOffset, true),
                dataView.getFloat32(prop[`f_rest_7`].offset + i*rowOffset, true),
                dataView.getFloat32(prop[`f_rest_22`].offset +i*rowOffset, true),
                dataView.getFloat32(prop[`f_rest_37`].offset +i*rowOffset, true),
                dataView.getFloat32(prop[`f_rest_8`].offset + i*rowOffset, true),
                dataView.getFloat32(prop[`f_rest_23`].offset +i*rowOffset, true),
                dataView.getFloat32(prop[`f_rest_38`].offset +i*rowOffset, true),
                dataView.getFloat32(prop[`f_rest_9`].offset + i*rowOffset, true),
                dataView.getFloat32(prop[`f_rest_24`].offset +i*rowOffset, true),
                dataView.getFloat32(prop[`f_rest_38`].offset +i*rowOffset, true),
                dataView.getFloat32(prop[`f_rest_10`].offset +i*rowOffset, true),
                dataView.getFloat32(prop[`f_rest_25`].offset +i*rowOffset, true),
                dataView.getFloat32(prop[`f_rest_40`].offset +i*rowOffset, true),
                dataView.getFloat32(prop[`f_rest_11`].offset +i*rowOffset, true),
                dataView.getFloat32(prop[`f_rest_26`].offset +i*rowOffset, true),
                dataView.getFloat32(prop[`f_rest_41`].offset +i*rowOffset, true),
                dataView.getFloat32(prop[`f_rest_12`].offset +i*rowOffset, true),
                dataView.getFloat32(prop[`f_rest_27`].offset +i*rowOffset, true),
                dataView.getFloat32(prop[`f_rest_42`].offset +i*rowOffset, true),
                dataView.getFloat32(prop[`f_rest_13`].offset +i*rowOffset, true),
                dataView.getFloat32(prop[`f_rest_28`].offset +i*rowOffset, true),
                dataView.getFloat32(prop[`f_rest_43`].offset +i*rowOffset, true),
                dataView.getFloat32(prop[`f_rest_14`].offset +i*rowOffset, true),
                dataView.getFloat32(prop[`f_rest_29`].offset +i*rowOffset, true),
                dataView.getFloat32(prop[`f_rest_44`].offset +i*rowOffset, true),
            ], 3);
            // for(let j = 0; j < 45; j ++) {
            //     const index = 3 + ((j % 15)*3 + Math.floor(j / 15));
            //     sh[index] =  input[(header.properties[propInd[`f_rest_${j}`]].offset / 4) + floatOffset];
            // }
        }

        // onProgress?.(1, true);


        return [dataBuffer, shsBuffer];
    }

    //Must parse all 48 shs
    private static _ParseFullPLYBuffer(inputBuffer: ArrayBuffer, format: string): [ArrayBuffer, ArrayBuffer] {
        // type PlyProperty = {
        //     name: string;
        //     type: string;
        //     offset: number;
        // };

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
        console.log("ROW OFFSET " + rowOffset)
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
                            rgba[0] = (0.5 + SH_C0 * value) * 255;
                            sh[0] = value;
                            minDc[0] = value < minDc[0] ? value : minDc[0]; 
                            maxDc[0] = value > maxDc[0] ? value : maxDc[0]; 
                            break;
                            case "f_dc_1":
                            rgba[1] = (0.5 + SH_C0 * value) * 255;
                            sh[1] = value;
                            minDc[1] = value < minDc[1] ? value : minDc[1];
                            maxDc[1] = value > maxDc[1] ? value : maxDc[1];
                            break;
                            case "f_dc_2":
                            rgba[2] = (0.5 + SH_C0 * value) * 255;
                            sh[2] = value;
                            minDc[2] = value < minDc[2] ? value : minDc[2];
                            maxDc[2] = value > maxDc[2] ? value : maxDc[2];
                            break;
                        case "f_dc_3":
                            rgba[3] = (0.5 + SH_C0 * value) * 255;
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

        console.log("parsing ...")

        let before = performance.now();
        type PlyProperty = {
            name: string;
            type: string;
            offset: number;
        };

        type CodeBook = {
            name: string,
            data: Float32Array
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
        
        // console.log(vertexCounts);
        
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
            // console.log(`${vertexCount} Vertices.`)
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
            cb.push({name, data: new Float32Array(256)});
            cbIndex[name] = ind;
            ind ++;
        }

        // console.log(cb);

        // console.log("CB INDEX OBJECT: ");
        // console.log(cbIndex);

                    
        // console.log(dataByteSizeRead + " bytes before codebooks.");
        const nbCodeBooks = cb.length;
        const cbDataView = new DataView(inputBuffer, dataByteSizeRead + header_end_index + header_end.length, nbCodeBooks * 2 * 256);

        for(let j = 0; j < nbCodeBooks; j ++) {
            for(let i = 0; i < 256; i ++) {     
                const encoded  = cbDataView.getInt16((i*nbCodeBooks*2) + (j*2), true);
                cb[j].data[i] = decodeFloat16(new Int16Array([encoded]), 0, 1)[0];
            }
        }

        // console.log("CODEBOOKS: ");
        // console.log(cb);

        const shRowLength = 4 * ((1*3) + (15*3)); //diffuse + 3 degrees of spherical harmonics in bytes
        const valDataView = new DataView(inputBuffer, header_end_index + header_end.length, dataByteSizeRead);
        const dataBuffer = new ArrayBuffer(Scene.RowLength * totalVertexCount);
        const shsBuffer = new ArrayBuffer(shRowLength * (vertexCounts[1] + vertexCounts[2] + vertexCounts[3]));

        // console.log(`sh texture of size ${vertexCounts[3]} * ${shRowLength} bytes`);


        let after = performance.now();
        console.log(`setting codebook, preparing for data fetching took ${after - before}ms.`);


        // create a dictionnary from the properties in header
        const props = []
        for(let i = 0; i < 4; i ++) {
            const prop: Record<string, PlyProperty> = properties[i].reduce((acc: Record<string, PlyProperty>, item: PlyProperty) => {
                acc[item.name] = item;
                return acc;
            }, {});

            props.push(prop);
        }


        //main loop
        let shLength = 0;
        let writeOffset = 0;
        let readOffset = 0;
        let shOffset = 0;

        const shStrideLut = [3, 8, 15];
        let shStride = 0;
        const sh0offset= props[1]["f_rest_0"].offset
        for(let i = 0; i < 4; i ++) {
            before = performance.now();

            const vertexCount : number  = vertexCounts[i];
            const prop = props[i];
            const rowOffsetRead = rowOffsetsRead[i];
            
            if(i > 0){
                shLength = shRowLength;
                shStride = shStrideLut[i-1];
            } 

            // console.log(cb)
            // console.log(prop)
            const sh_prop = properties[i].filter((p) => p.name.startsWith("f_rest"));

            for(let v = 0; v < vertexCount; v ++) {
                const position = new Float32Array(dataBuffer, writeOffset + v * Scene.RowLength, 3);
                const scale = new Float32Array(dataBuffer, writeOffset + v * Scene.RowLength + 12, 3);
                const rgba = new Uint8ClampedArray(dataBuffer, writeOffset + v * Scene.RowLength + 24, 4);
                const rot = new Uint8ClampedArray(dataBuffer, writeOffset + v * Scene.RowLength + 28, 4);
                const sh = new Float32Array(shsBuffer, shOffset + v * shLength, shLength/4);

                let r = [255, 0, 0, 0];
                let index, indexInCb, h;

                // POSITION
                position.set([
                    decodeFloat16(new Int16Array([
                        valDataView.getInt16(readOffset + prop['x'].offset + v * rowOffsetRead, true)
                    ]), 0, 1)[0],
                    decodeFloat16(new Int16Array([
                        valDataView.getInt16(readOffset + prop['y'].offset + v * rowOffsetRead, true)
                    ]), 0, 1)[0],
                    decodeFloat16(new Int16Array([
                        valDataView.getInt16(readOffset + prop['z'].offset + v * rowOffsetRead, true)
                    ]), 0, 1)[0],
                ], 0);

                
                // SCALING
                index = cbIndex["scaling"]
                scale.set([
                    Math.exp(cb[index].data[valDataView.getUint8(readOffset + prop["scale_0"].offset + v * rowOffsetRead)]),
                    Math.exp(cb[index].data[valDataView.getUint8(readOffset + prop["scale_1"].offset + v * rowOffsetRead)]),
                    Math.exp(cb[index].data[valDataView.getUint8(readOffset + prop["scale_2"].offset + v * rowOffsetRead)]),
                ], 0);

                // ROTATION
                const pRotRe = prop["rot_0"];
                index = valDataView.getUint8(readOffset + pRotRe.offset + v * rowOffsetRead);
                indexInCb = cbIndex["rotation_re"];
                h = cb[indexInCb].data[index];
                // r[0] = decodeFloat16(new Int16Array([h]), 0, 1)[0];
                r[0] = h;

                for(let j = 1; j < 4; j ++) {
                    const pRot = prop[`rot_${j}`];
                    index = valDataView.getUint8(readOffset + pRot.offset + v * rowOffsetRead);
                    indexInCb = cbIndex["rotation_im"];
                    h = cb[indexInCb].data[index];
                    // r[j] = decodeFloat16(new Int16Array([h]), 0, 1)[0];
                    r[j] = h;
                }

                let q = new Quaternion(r[1], r[2], r[3], r[0]);
                q = q.normalize();

                rot.set([
                    q.w* 128 + 128,
                    q.x* 128 + 128,
                    q.y* 128 + 128,
                    q.z* 128 + 128
                ], 0);


                // RGBA 
                rgba.set([
                    (0.5 + SH_C0 * cb[cbIndex["features_dc"]].data[
                        valDataView.getUint8(readOffset + prop["f_dc_0"].offset + v * rowOffsetRead)
                    ]) * 255,
                    (0.5 + SH_C0 * cb[cbIndex["features_dc"]].data[
                        valDataView.getUint8(readOffset + prop["f_dc_1"].offset + v * rowOffsetRead)
                    ]) * 255,
                    (0.5 + SH_C0 * cb[cbIndex["features_dc"]].data[
                        valDataView.getUint8(readOffset + prop["f_dc_2"].offset + v * rowOffsetRead)
                    ]) * 255,
                    (1 / (1 + Math.exp( -cb[cbIndex["opacity"]].data[
                        valDataView.getUint8(readOffset + prop["opacity"].offset + v * rowOffsetRead)
                    ]))) * 255,
                ], 0);


                //SPHERICAL HARMONICS
                if(i > 0) {

                    // Diffuse components
                    sh.set([
                        cb[cbIndex["features_dc"]].data[
                            valDataView.getUint8(readOffset + prop["f_dc_0"].offset + v * rowOffsetRead)
                        ],
                        cb[cbIndex["features_dc"]].data[
                            valDataView.getUint8(readOffset + prop["f_dc_1"].offset + v * rowOffsetRead)
                        ],
                        cb[cbIndex["features_dc"]].data[
                            valDataView.getUint8(readOffset + prop["f_dc_2"].offset + v * rowOffsetRead)
                        ],
                    ], 0);

                    // Higher bands (max 3 bands enabled)
                    sh.set(sh_prop.map((p : PlyProperty, mapIndex: number) : number => {                        
                        const n14 = Math.floor(mapIndex / 3);
                        const currentShOffset = sh0offset + (n14 + shStride*(mapIndex % 3));
                        index = valDataView.getUint8(readOffset + currentShOffset + v * rowOffsetRead);
                        
                        indexInCb = cbIndex[`features_rest_${n14}`];
                        return cb[indexInCb].data[index]
                    }), 3);
                }

            }

            after = performance.now();
            console.log(`parsing ${vertexCount} vertices took ${after - before}ms.`);

                
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
