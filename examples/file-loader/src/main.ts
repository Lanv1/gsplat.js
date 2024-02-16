import * as SPLAT from "../../../dist/index";

const renderer = new SPLAT.WebGLRenderer();
const scene = new SPLAT.Scene();
let camera = new SPLAT.Camera();
let controls = new SPLAT.OrbitControls(camera, renderer.domElement);

let canvasElem = document.querySelector("canvas");
let progressElem = document.getElementById("progress_bar");
let loadingElem = document.getElementById("loading_bar");
let loadingDesc = document.getElementById("loading_desc");
// const camFileElem = document.getElementById("input_cam");
// const exportBtnElem = document.getElementById("exportBtn");
// const screenshotBtnElem = document.getElementById("screenshot");
// const camSelectorBtnElem = document.getElementById("camSelector");
// let camSelectorLabelElem = document.getElementById("selectedCam");

let loading = false;
let selectedCam = 0;
let cameras : any;
let captureFrame = false;

let barDesc = 'Loading'
let barProgress = 0

let useShs = true;
let parseElemCreated = false;
let parseElem : HTMLElement;

function updateBar() {
    (loadingDesc as HTMLElement).textContent = `${barDesc} ${barProgress.toFixed(2)}`;

    if(barDesc == "Parsing" && !parseElemCreated) {
        (progressElem as HTMLElement).style.opacity = "0.";
        loadingElem?.removeChild(progressElem as HTMLProgressElement);

        parseElemCreated = true;
        parseElem = document.createElement('i');
        parseElem.classList.add("fa-solid");
        parseElem.classList.add("fa-spinner");
        parseElem.classList.add("rotate-icon");
        loadingElem?.appendChild(parseElem);
    } else {

        (progressElem as HTMLProgressElement).value = 100 * barProgress;
    }
}

const quantized = true;

async function loadFile(file: File) {
    if (loading) return;
    loading = true;
    // Check if .splat file

    (loadingElem as HTMLElement).style.opacity = "1";
    (canvasElem as HTMLElement).style.opacity = "0.1";
    const format = "";
    // const format = "polycam"; // Uncomment to load a Polycam PLY file
    await SPLAT.PLYLoader.LoadFromFileAsync(
        file,
        scene,
        updateProgress,
        format,
        useShs,
        quantized    // flag to use quantized parser or not
    ).then(endProgress);
        
    loading = false;
}

async function loadFileUrl(url: string) {
    if (loading) return;
    loading = true;
    // Check if .splat file

    (loadingElem as HTMLElement).style.opacity = "1";
    (canvasElem as HTMLElement).style.opacity = "0.1";
    const format = "";
    // const format = "polycam"; // Uncomment to load a Polycam PLY file
    await SPLAT.PLYLoader.LoadAsync(
        url,
        scene,
        updateProgress,
        format,
        useShs,
        quantized    // flag to use quantized parser or not
    ).then(endProgress);
        
}

function updateProgress(progress : number, loadingDone: boolean = false) : void {

    barProgress = progress;
    if(loadingDone) {
        barDesc = "Parsing";

    }

}

function endProgress() : void {
    (loadingElem as HTMLElement).style.opacity = "0";
    (canvasElem as HTMLElement).style.opacity = "1";
    barDesc = "Loading";
    loading = false;
    loadingElem?.appendChild(progressElem as HTMLProgressElement);
    loadingElem?.removeChild(parseElem);
    parseElemCreated = false;
}


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
            true,
            true    // flag to use quantized parser or not
        );
    }
    loading = false;
}

// Listen for file drops
document.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.dataTransfer != null) {

        loadFile(e.dataTransfer.files[0])
        // selectFile(e.dataTransfer.files[0]);
    }
});


async function main() {

        // Load a placeholder scene
    const url = "https://huggingface.co/datasets/dylanebert/3dgs/resolve/main/bonsai/point_cloud/iteration_7000/point_cloud.ply";
    // const url = "https://huggingface.co/datasets/dylanebert/3dgs/resolve/main/bicycle/point_cloud/iteration_7000/point_cloud.ply";
    // loadFileUrl(url);

    // Render loop
    const frame = () => {
        controls.update();
        renderer.render(scene, camera);

        if(loading)
            updateBar();
        // if(captureFrame) {
        //     captureFrame = false;
        //     const dataURL = renderer.domElement.toDataURL("image/png", 1.0);
        //     window.open(dataURL, '_blank')
        //     // renderer.domElement.toBlob((blob : any) => window.open(URL.createObjectURL(dataURL), '_blank'));
            
        // }
        requestAnimationFrame(frame);
    };

    requestAnimationFrame(frame);


}

main();