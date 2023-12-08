import * as SPLAT from "../../../dist/index";

const renderer = new SPLAT.WebGLRenderer();
const scene = new SPLAT.Scene();
const camera = new SPLAT.Camera();
const controls = new SPLAT.OrbitControls(camera, renderer.domElement);

const camFileElem = document.getElementById("input_cam");
const exportBtnElem = document.getElementById("exportBtn");

let loading = false;

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
            camera.setFromFile(file);
        }
    });

    exportBtnElem?.addEventListener("click", (event: Event) => {
        console.log("export clicked");
        camera.dumpSettings(renderer.domElement.width, renderer.domElement.height);
    });

    // Render loop
    const frame = () => {
        controls.update();
        renderer.render(scene, camera);

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