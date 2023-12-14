import * as SPLAT from "../../../dist/index";

const renderer = new SPLAT.WebGLRenderer();
const scene = new SPLAT.Scene();
let camera = new SPLAT.Camera();
let controls = new SPLAT.OrbitControls(camera, renderer.domElement);

const camFileElem = document.getElementById("input_cam");
const exportBtnElem = document.getElementById("exportBtn");
const screenshotBtnElem = document.getElementById("screenshot");
const camSelectorBtnElem = document.getElementById("camSelector");
let camSelectorLabelElem = document.getElementById("selectedCam");

let loading = false;
let selectedCam = 0;
let cameras : any;
let captureFrame = false;

function downloadCanvasAsImage(event: Event)
{
    // open canvas as image in new window
    // canvas.toBlob((blob : any) => window.open(URL.createObjectURL(blob), '_blank'));

    const target = new Image();
    target.src = renderer.domElement.toDataURL();
    renderer.domElement.appendChild(target);
}

async function selectFile(file: File) {
    if (loading) return;
    loading = true;
    // Check if .splat file
    if (file.name.endsWith(".splat")) {
        await SPLAT.Loader.LoadFromFileAsync(file, scene);
    } else if (file.name.endsWith(".ply")) {
        const format = "";
        // const format = "polycam"; // Uncomment to load a Polycam PLY file
        await SPLAT.PLYLoader.LoadFromFileAsync(
            file,
            scene,
            undefined,
            format,
            true
        );
    }
    loading = false;
}

async function main() {
    // Load a placeholder scene
    // const url = "https://huggingface.co/datasets/dylanebert/3dgs/resolve/main/bonsai/bonsai-7k.splat";
    // await SPLAT.Loader.LoadAsync(url, scene, () => {});

    camFileElem?.addEventListener("change", (event : Event) => {
        const input = event.target as HTMLInputElement;
        if(input.files && input.files.length) {
            const file = input.files[0];
            const reader = new FileReader();
            reader.onload = (e) => {
                cameras = JSON.parse(e.target!.result as string);
                // camera.setFromData(cameras[selectedCam]);

                camera = SPLAT.Camera.fromData(cameras[selectedCam]);
                controls.setCamera(camera);
                // controls = new SPLAT.OrbitControls(camera, renderer.domElement);
                // controls.setCameraTarget(camera.position);
            };
            reader.onprogress = (e) => {
            };
            reader.readAsText(file);
            new Promise<void>((resolve) => {
                reader.onloadend = () => {
                    resolve();
                };
            });
            
            (camSelectorLabelElem as HTMLInputElement).value = "0";
        }
    });

    exportBtnElem?.addEventListener("click", (event: Event) => {
        console.log("export clicked");
        camera.dumpSettings(renderer.domElement.width, renderer.domElement.height);
    });
    
    camSelectorBtnElem?.addEventListener("click", (event: Event) => {
        console.log("next cam clicked");
        const nbCam = cameras.length;
        selectedCam = (selectedCam + 1) % nbCam;
        
        // camera.setFromData(cameras[selectedCam]);
        camera = SPLAT.Camera.fromData(cameras[selectedCam]);
        controls.setCamera(camera);

        
        (camSelectorLabelElem as HTMLInputElement).value = selectedCam.toString();
    });
    
    camSelectorLabelElem?.addEventListener("input", (event: Event) => {
        const val : number = parseInt((event.target  as HTMLInputElement).value);
        
        if (val < cameras.length) {
            selectedCam = val;
            camera = SPLAT.Camera.fromData(cameras[selectedCam]);
            controls.setCamera(camera);        
        }
    });

    screenshotBtnElem?.addEventListener("click", (ev: Event) => { 
        renderer.render(scene, camera);
        renderer.domElement.toBlob((blob : any) =>  window.open(URL.createObjectURL(blob), '_blank'));
        
    });

    // Render loop
    const frame = () => {
        controls.update();
        renderer.render(scene, camera);

        // if(captureFrame) {
        //     captureFrame = false;
        //     const dataURL = renderer.domElement.toDataURL("image/png", 1.0);
        //     window.open(dataURL, '_blank')
        //     // renderer.domElement.toBlob((blob : any) => window.open(URL.createObjectURL(dataURL), '_blank'));
            
        // }
        requestAnimationFrame(frame);
    };

    requestAnimationFrame(frame);

    // Listen for file drops
    document.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (e.dataTransfer != null) {
            selectFile(e.dataTransfer.files[0]);
        }
    });
}

main();