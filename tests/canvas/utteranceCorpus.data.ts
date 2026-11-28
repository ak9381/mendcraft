// Lines as speech recognition really hands them over (mishearings kept), what
// the canvas looks like, and where each must land. `tier`: fixed = a fixed
// phrase route; nano = no fixed phrase, Nano's pick (the intent shown) runs or
// asks; clarify = a command nothing can place (the choices card); chat = talk.
import { INTENT_ACTIONS } from '../../src/canvas/intentRouter';
import type { RouteName, RouteWorld } from '../../src/canvas/routeLine';

export type CorpusTier = 'fixed' | 'nano' | 'clarify' | 'chat';
export interface CorpusRow { heard: string; world?: Partial<RouteWorld>; tier: CorpusTier; route?: RouteName; intent?: string }

const lamp = { id: 'lamp-a', label: 'Desk lamp', kind: 'lamp' as const };
const speaker = { id: 'speaker-a', label: 'Speaker', kind: 'music' as const };
export const BASE_WORLD: RouteWorld = { hasPlanBoard: false, devices: [lamp, speaker] };

const ACTION_ROUTE: Record<string, RouteName> = {
  showDevices: 'showDevices', buildDashboard: 'connectRoom', connectGimbal: 'connectRoom', pointConnect: 'pointConnect',
  connectPhones: 'connectDevices', connectLamp: 'connectByName', connectSpeaker: 'connectByName', floorPlan: 'floorPlan', newBoard: 'canvas',
};

export const CORPUS: readonly CorpusRow[] = [
  // ---- the status board: by its words, by purpose, misheard ----
  { heard: 'show my devices', tier: 'fixed', route: 'showDevices' },
  { heard: "what's connected", tier: 'fixed', route: 'showDevices' },
  { heard: 'build me a dashboard to keep track of all my devices and their status', tier: 'fixed', route: 'showDevices' },
  { heard: 'build me about to keep track of all my devices and their status and to point and connect another if needed', tier: 'fixed', route: 'showDevices' },
  { heard: 'belt me a bored to keep track of all my devices and their status', tier: 'fixed', route: 'showDevices' },
  { heard: 'Build me a bored to keep track of my devices', tier: 'fixed', route: 'showDevices' },
  { heard: 'make a boat that shows the status of my connected devices', tier: 'fixed', route: 'showDevices' },
  { heard: 'build me a dash board to keep track of my devices', tier: 'fixed', route: 'showDevices' },
  { heard: 'something to keep track of all my devices and their status', tier: 'nano', intent: 'showDevices' },
  // ---- the dashboard: by its word, by purpose, misheard ----
  { heard: 'build the dashboard', tier: 'fixed', route: 'connectRoom' },
  { heard: 'build me a dashboard to control my lamp and speaker', tier: 'fixed', route: 'connectRoom' },
  { heard: 'bolt a dashboard to control my lamp', tier: 'fixed', route: 'connectRoom' },
  { heard: 'build a dash board to control the lamp', tier: 'fixed', route: 'connectRoom' },
  { heard: 'add the speaker to the dashboard', tier: 'fixed', route: 'connectRoom' },
  { heard: 'make a board with buttons to turn on my lamp', tier: 'nano', intent: 'buildDashboard' },
  // ---- the floor plan: by its word, by purpose, misheard ----
  { heard: 'draw the floor plan', tier: 'fixed', route: 'floorPlan' },
  { heard: "floor plan for Mrs Sharma's flat", tier: 'fixed', route: 'floorPlan' },
  { heard: 'draw a flaw plan of my flat', tier: 'fixed', route: 'floorPlan' },
  { heard: 'show the floor plane of a two bedroom flat', tier: 'fixed', route: 'floorPlan' },
  { heard: 'draw my flat', tier: 'nano', intent: 'floorPlan' },
  // ---- the gimbal, as speech hears it ----
  { heard: 'connect the gymbo', tier: 'fixed', route: 'connectRoom' },
  { heard: 'add my kimbo', tier: 'fixed', route: 'connectRoom' },
  { heard: 'Connect the Jimbo stand', tier: 'fixed', route: 'connectRoom' },
  { heard: 'pair the gimble', tier: 'fixed', route: 'connectRoom' },
  { heard: 'follow my face', tier: 'fixed', route: 'gimbal' },
  // ---- devices and pairing ----
  { heard: 'turn on the desk lamp', tier: 'fixed', route: 'device' },
  { heard: 'play music', tier: 'fixed', route: 'device' },
  { heard: 'is the lamp on?', tier: 'fixed', route: 'deviceState' },
  { heard: 'connect my phones', tier: 'fixed', route: 'connectDevices' },
  { heard: "connect to what I'm pointing at", tier: 'fixed', route: 'pointConnect' },
  { heard: 'new board', tier: 'fixed', route: 'canvas' },
  // ---- nothing can place it: ask with choices, never chat ----
  { heard: 'build me a thing for the stuff', tier: 'clarify' },
  { heard: 'I want a board for my stuff', tier: 'clarify' },
  { heard: 'can you put everything on one screen', tier: 'clarify' },
  // ---- talk ----
  { heard: 'what is a gimbal?', tier: 'chat' },
  { heard: 'tell me about gimbals', tier: 'chat' },
  { heard: 'how are you', tier: 'chat' },
  { heard: 'a bird flew by', tier: 'chat' },
  { heard: 'what is the belt of Orion', tier: 'chat' },
  // ---- every action's own fixed phrase ----
  ...INTENT_ACTIONS.map((a): CorpusRow => ({ heard: a.phrase('of a two bedroom flat'), tier: 'fixed', route: ACTION_ROUTE[a.id] })),
];
