// Entry for /canvas.html (sim-main smart canvas).
import '../style.css';
import './canvas.css';
import { mountCanvas } from './canvasApp';
import { createVoiceController } from '../input/voice';

const root = document.getElementById('canvas')!;
if (new URLSearchParams(location.search).has('fresh')) localStorage.removeItem('mc.canvas.v1');
let handle: ReturnType<typeof mountCanvas> | null = null;
const voice = createVoiceController((t) => handle?.run(t));
handle = mountCanvas(root, { voice });
(window as unknown as { __canvas: unknown }).__canvas = handle;
