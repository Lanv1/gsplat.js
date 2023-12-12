import { Object3D } from "../core/Object3D";
import { Quaternion } from "../math/Quaternion";
import { Matrix3 } from "../math/Matrix3";
import { Matrix4 } from "../math/Matrix4";
import { Vector3 } from "../math/Vector3";

class Camera extends Object3D {

    fx: number;
    fy: number;

    near: number;
    far: number;

    projectionMatrix: Matrix4;
    viewMatrix: Matrix4;
    viewProj: Matrix4;

    viewToWorld: Matrix4;

    update: (width: number, height: number) => void;
    constructor(
        position = new Vector3(0, 0, 0),
        rotation = new Quaternion(),
        fx = 1132,
        fy = 1132,
        near = 0.01,
        far = 1000,
    ) {
        super();

        const getViewMatrix = (): Matrix4 => {
            const R = Matrix3.RotationFromQuaternion(this.rotation).buffer;
            const t = this.position.flat();
            const camToWorld = [
                [R[0], R[1], R[2], 0],
                [R[3], R[4], R[5], 0],
                [R[6], R[7], R[8], 0],
                [
                    -t[0] * R[0] - t[1] * R[3] - t[2] * R[6],
                    -t[0] * R[1] - t[1] * R[4] - t[2] * R[7],
                    -t[0] * R[2] - t[1] * R[5] - t[2] * R[8],
                    1,
                ],
            ].flat();
            
            const arr = [
                [R[0], R[3], R[6], t[0]],
                [R[1], R[4], R[7], t[1]],
                [R[2], R[5], R[8], t[2]],
                [0, 0, 0, 1],
            ].flat();
            this.viewToWorld = new Matrix4(...arr);
            
            return new Matrix4(...camToWorld);
        };

        const getViewMatrix2 = (): Matrix4 => {
            const R = Matrix3.RotationFromQuaternion(this.rotation).buffer;
            const t = this.position.flat();
            const camToWorld = [
                [R[0], R[3], R[6], t[0]],
                [R[1], R[4], R[7], t[1]],
                [R[2], R[5], R[8], t[2]],
                [0, 0, 0, 1]
            ].flat();
            return new Matrix4(...camToWorld);
        };

        this.position = position;
        this.rotation = rotation;
        this.fx = fx;
        this.fy = fy;
        this.near = near;
        this.far = far;
        this.projectionMatrix = new Matrix4();
        this.viewMatrix = new Matrix4();
        this.viewProj = new Matrix4();
        this.viewToWorld = new Matrix4();

        this.update = (width: number, height: number) => {
            // prettier-ignore
            this.projectionMatrix = new Matrix4(
                2 * this.fx / width, 0, 0, 0,
                0, -2 * this.fy / height, 0, 0,
                0, 0, this.far / (this.far - this.near), 1,
                0, 0, -(this.far * this.near) / (this.far - this.near), 0
            );

            // let fovX = 2*Math.atan(width/(2*fx));
            // let fovY = 2*Math.atan(height/(2*fy));

            // let tanHalfFovY = Math.tan((fovY / 2));
            // let tanHalfFovX = Math.tan((fovX / 2));
        
            // let top = tanHalfFovY * this.near;
            // let bottom = -top;
            // let right = tanHalfFovX * this.near;
            // let left = -right;
            // let z_sign = 1.0;

            // this.projectionMatrix = new Matrix4(
            //     2 * near / (right - left), 0, (right + left) / (right - left), 0,
            //     0, 2 * near / (top - bottom), (top + bottom) / (top - bottom), 0,
            //     0, 0, z_sign * far / (far - near), -(far * near) / (far - near),
            //     0, 0, z_sign, 0
            // );
            // this.viewMatrix = getViewMatrix2();
            this.viewMatrix = getViewMatrix();
            this.viewProj = this.projectionMatrix.multiply(this.viewMatrix);

        };        
    }

    setFromData(data: any): void {
        if(data.position.x != undefined) {
            this.position = new Vector3(data.position.x, data.position.y, data.position.z);
        } else {
            let pos : Float32Array = data.position;
            this.position = new Vector3(...pos);
        }
        
        if(data.rotation.x != undefined) {
            this.rotation = new Quaternion(data.rotation.x, data.rotation.y, data.rotation.z, data.rotation.w);
        } else {
            let rots : Float32Array = data.rotation.flat();
            let rotmat = new Matrix3(...rots);
            this.rotation = Quaternion.FromMatrix3(rotmat);          
        }
        
        console.log(`camera loaded settings: pos ${this.position.x}, ${this.position.y}, ${this.position.z}`);
        console.log("rotation: ");
        console.log(Matrix3.RotationFromQuaternion(this.rotation).buffer);
    
        this.fx = data.fx;
        this.fy = data.fy;

        
        let mat90z = Matrix3.RotationFromEuler(new Vector3(0., 0., Math.PI/2.));
        console.log(mat90z.buffer);

        let mat90x = Matrix3.RotationFromEuler(new Vector3(Math.PI/2., 0., 0.));
        console.log(mat90x.buffer);

        let mat90y = Matrix3.RotationFromEuler(new Vector3(0., Math.PI/2., 0.));
        console.log(mat90y.buffer); 

        this.update(data.width, data.height);
    }

    dumpSettings(width: Number, height: Number): void {
        const data: any = {
            "id":0,
            "img_name": "NONE",
            "width": width,
            "height": height,
            "position": this.position,
            "rotation": this.rotation,
            "fy": this.fy,
            "fx": this.fx
        };

        console.log(JSON.stringify(data));

        console.log("CAM POSITION" + "[" + this.position.x + ", " + this.position.y + ", " + this.position.z + "]");
        console.log(Matrix3.RotationFromQuaternion(this.rotation).buffer);

        console.log("actual cam viewmatrix: ");
        console.log(this.viewMatrix.buffer);
    }

}

export { Camera };
