import { Scene } from "../core/Scene";
import { Vector3 } from "../math/Vector3";
import { Quaternion } from "../math/Quaternion";

class PLYLoader {
    static SH_C0 = 0.28209479177387814;

    static async LoadAsync(
        url: string,
        scene: Scene,
        onProgress?: (progress: number) => void,
        format: string = "",
        useShs: boolean = false,
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

        // eslint-disable-next-line no-constant-condition
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            plyData.set(value, bytesRead);
            bytesRead += value.length;

            onProgress?.(bytesRead / contentLength);
        }

        if (plyData[0] !== 112 || plyData[1] !== 108 || plyData[2] !== 121 || plyData[3] !== 10) {
            throw new Error("Invalid PLY file");
        }

        if(useShs) {
            let before = performance.now();
            // const rawData = this._ParseFullPLYBuffer(plyData.buffer, format);
            const rawData = this._ParseQPLYBuffer(plyData.buffer, format);
            let after = performance.now();

            console.log("PLY file loading took " + (after - before) + " ms.");
            
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
        useShs: boolean = false
    ): Promise<void> {
        const reader = new FileReader();
        reader.onload = (e) => {
            if(useShs) {
                
                let before = performance.now();
                // const rawData = this._ParseFullPLYBuffer(e.target!.result as ArrayBuffer, format);
                const rawData = this._ParseQPLYBuffer(e.target!.result as ArrayBuffer, format);

                let after = performance.now();
                const data = new Uint8Array(rawData[0]);
                const shData = new Float32Array(rawData[1]);

                console.log("PLY file loading took " + (after - before) + " ms.");
                
                before = performance.now();            
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
                    const index = 3 + ((n % 15)*3 + (n / 15));
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
    private static _ParseQPLYBuffer(inputBuffer: ArrayBuffer, format: string): [ArrayBuffer, ArrayBuffer] {
        type PlyProperty = {
            name: string;
            type: string;
            offset: number;
        };

        type CodeBook = {
            name: string,
            data: Int16Array
        };

        const shRowLength = 4 * ((1*3) + (15*3)); //diffuse + 3 degrees of spherical harmonics in bytes

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

        let lutExtents : Array<Array<number>> = [
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
        let dataByteOffset = 0;
        let propOffset = 0;
        const properties : Array<PlyProperty[]> = [];
        for(let i = 0; i < 4; i ++) {
            const vertexCount : number  = vertexCounts[i];
            const start : number = lutExtents[i][0];
            const end : number  = lutExtents[i][1]; 
            
            let rowOffset = 0;
            const vertexProperties : PlyProperty[] = [];

            for (const prop of headerText
                .slice(start, end)
                .split("\n")
                .filter((k) => k.startsWith("property "))) {

                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const [_p, type, name] = prop.split(" ");
                vertexProperties.push({ name, type, offset: propOffset });
                if (!offsets[type]) throw new Error(`Unsupported property type: ${type}`);
                rowOffset += offsets[type];
                propOffset += offsets[type];
            }

            properties.push(vertexProperties);

            dataByteOffset += vertexCount*rowOffset;
            console.log(properties);
        }
        
        // fill codebooks
        //cb contains each codebooks as int16Array(256)
        const cb : CodeBook[] = [];
        
        for (const prop of headerText
            .slice(start_codebook_index, header_end_index)
            .split("\n")
            .filter((k) => k.startsWith("property "))) {
                        
            const [_p, type, name] = prop.split(" ");
            cb.push({name, data: new Int16Array(256)});
        }
                    
        console.log(dataByteOffset + " bytes before codebooks.");
        const nbCodeBooks = cb.length;
        const cbDataView = new DataView(inputBuffer, dataByteOffset + start_codebook_index + start_codebook.length, nbCodeBooks * 2 * 256);

        for(let i = 0; i < 256; i ++) {
           for(let j = 0; j < nbCodeBooks; j ++) {
                cb[j].data[i] = cbDataView.getInt16((i*nbCodeBooks*2) + (j*2), true);
            }
        }

        console.log(cb);


        //main loop
        for(let i = 0; i < 4; i ++) {
            const vertexCount : number  = vertexCounts[i];
            const prop : PlyProperty[] = properties[i];
            
            for(let v = 0; v < vertexCount; v ++) {
                
                prop.forEach((p) => {
                    // FILL ARRAYS HERE?.
                });
            }

        }

        // const properties: PlyProperty[] = [];
        // for (const prop of headerText
        //     .slice(0, header_end_index)
        //     .split("\n")
        //     .filter((k) => k.startsWith("property "))) {
        //     // eslint-disable-next-line @typescript-eslint/no-unused-vars
        //     const [_p, type, name] = prop.split(" ");
        //     properties.push({ name, type, offset: rowOffset });
        //     if (!offsets[type]) throw new Error(`Unsupported property type: ${type}`);
        //     rowOffset += offsets[type];
        // }


        // const dataView = new DataView(inputBuffer, header_end_index + header_end.length);
        // const dataBuffer = new ArrayBuffer(Scene.RowLength * vertexCount);
        // const shsBuffer = new ArrayBuffer(shRowLength * vertexCount);

        // for (let i = 0; i < vertexCount; i++) {
        //     const position = new Float32Array(dataBuffer, i * Scene.RowLength, 3);
        //     const scale = new Float32Array(dataBuffer, i * Scene.RowLength + 12, 3);
        //     const rgba = new Uint8ClampedArray(dataBuffer, i * Scene.RowLength + 24, 4);
        //     const rot = new Uint8ClampedArray(dataBuffer, i * Scene.RowLength + 28, 4);
        //     const sh = new Float32Array(shsBuffer, i*shRowLength, 48);

        //     let r0: number = 255;
        //     let r1: number = 0;
        //     let r2: number = 0;
        //     let r3: number = 0; 

        //     properties.forEach((property) => {
        //         let value;
        //         switch (property.type) {
        //             case "float":
        //                 value = dataView.getFloat32(property.offset + i * rowOffset, true);
        //                 break;
        //             case "int":
        //                 value = dataView.getInt32(property.offset + i * rowOffset, true);
        //                 break;
        //             default:
        //                 throw new Error(`Unsupported property type: ${property.type}`);
        //         }

        //         if(property.name.startsWith("f_rest")) {
        //             //spherical harmonics coefficients
        //             let n = parseInt(property.name.split("_").slice(-1)[0])
        //             const index = 3 + ((n % 15)*3 + (n / 15));
        //             sh[index] = value;

        //         } else {

        //             switch (property.name) {
        //                 case "x":
        //                     position[0] = value;
        //                     break;
        //                 case "y":
        //                     position[1] = value;
        //                     break;
        //                 case "z":
        //                     position[2] = value;
        //                     break;
        //                 case "scale_0":
        //                     scale[0] = Math.exp(value);
        //                     break;
        //                 case "scale_1":
        //                     scale[1] = Math.exp(value);
        //                     break;
        //                 case "scale_2":
        //                     scale[2] = Math.exp(value);
        //                     break;
        //                 case "red":
        //                     rgba[0] = value;
        //                     break;
        //                 case "green":
        //                     rgba[1] = value;
        //                     break;
        //                 case "blue":
        //                     rgba[2] = value;
        //                     break;
        //                 case "f_dc_0":
        //                     rgba[0] = (0.5 + this.SH_C0 * value) * 255;
        //                     sh[0] = value;
        //                     break;
        //                     case "f_dc_1":
        //                     rgba[1] = (0.5 + this.SH_C0 * value) * 255;
        //                     sh[1] = value;
        //                     break;
        //                     case "f_dc_2":
        //                     rgba[2] = (0.5 + this.SH_C0 * value) * 255;
        //                     sh[2] = value;
        //                     break;
        //                 case "f_dc_3":
        //                     rgba[3] = (0.5 + this.SH_C0 * value) * 255;
        //                     break;
        //                 case "opacity":
        //                     rgba[3] = (1 / (1 + Math.exp(-value))) * 255;
        //                     break;
        //                 case "rot_0":
        //                     r0 = value;
        //                     break;
        //                 case "rot_1":
        //                     r1 = value;
        //                     break;
        //                 case "rot_2":
        //                     r2 = value;
        //                     break;
        //                 case "rot_3":
        //                     r3 = value;
        //                     break;
        //             }
        //         }

        //     });

        //     let q = new Quaternion(r1, r2, r3, r0);

        //     q = q.normalize();
        //     rot[0] = q.w * 128 + 128;
        //     rot[1] = q.x * 128 + 128;
        //     rot[2] = q.y * 128 + 128;
        //     rot[3] = q.z * 128 + 128;
        // }

        // return [dataBuffer, shsBuffer];

        return [new ArrayBuffer(0), new ArrayBuffer(0)];
    }
}

export { PLYLoader };
