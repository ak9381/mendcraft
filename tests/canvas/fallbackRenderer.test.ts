import { describe, expect, it, vi } from 'vitest';
import {
  createFallbackRenderer,
  reduceA2uiMessages,
  renderTreeToDom,
  type FallbackRendererState,
  type RenderTree,
} from '../../src/canvas/fallbackRenderer';
import { coerceSurfacePlan, expandPlan, deviceUpdate } from '../../src/canvas/surfacePlan';

describe('Part 5: src/canvas/fallbackRenderer.ts (pure reducer & fallback renderer)', () => {
  const samplePlan = {
    kind: 'room',
    title: 'Smart Studio',
    tiles: [
      { type: 'lamp', deviceId: 'lamp-1', label: 'Desk Lamp' },
      { type: 'music', deviceId: 'music-1', label: 'HiFi Audio' },
      { type: 'switch', deviceId: 'switch-1', label: 'Power Bar' },
      { type: 'scene', sceneId: 'scene-1', label: 'Evening Relax' },
      { type: 'connect' },
      { type: 'plan', boardId: 'board-1', template: 'studio' },
    ],
  };

  const initialDevices = {
    'lamp-1': { on: true, brightness: 75 },
    'music-1': { playing: true, volume: 60, trackTitle: 'Jazz Beats', on: false, brightness: 0 },
    'switch-1': { on: false, brightness: 0 },
  };

  it('reduces expandPlan messages into a complete RenderTree with resolved props', () => {
    const coerced = coerceSurfacePlan(samplePlan);
    if (!coerced.ok) throw new Error();

    const messages = expandPlan(coerced.value, 'surface-alpha', initialDevices as never);

    const { trees } = reduceA2uiMessages(undefined, messages);
    const tree = trees['surface-alpha'];

    expect(tree).toBeDefined();
    expect(tree.surfaceId).toBe('surface-alpha');
    expect(tree.root).toBeDefined();
    expect(tree.root?.id).toBe('root');
    expect(tree.root?.component).toBe('Column');

    // Title node
    const titleNode = tree.nodesById['title'];
    expect(titleNode).toBeDefined();
    expect(titleNode.component).toBe('Text');
    expect(titleNode.props.text).toBe('Smart Studio');

    // Lamp node with resolved data-model bindings
    const lampNode = tree.nodesById['lamp-lamp-1'];
    expect(lampNode).toBeDefined();
    expect(lampNode.component).toBe('LampTile');
    expect(lampNode.props.label).toBe('Desk Lamp');
    expect(lampNode.props.on).toBe(true);
    expect(lampNode.props.brightness).toBe(75);
    expect(lampNode.props.onToggle).toMatchObject({
      event: { name: 'lamp.toggle', context: { deviceId: 'lamp-1' } },
    });

    // Music node with resolved data-model bindings
    const musicNode = tree.nodesById['music-music-1'];
    expect(musicNode).toBeDefined();
    expect(musicNode.component).toBe('MusicTile');
    expect(musicNode.props.label).toBe('HiFi Audio');
    expect(musicNode.props.playing).toBe(true);
    expect(musicNode.props.volume).toBe(60);
    expect(musicNode.props.trackTitle).toBe('Jazz Beats');
    expect(musicNode.props.onPlayPause).toMatchObject({
      event: { name: 'music.playPause', context: { deviceId: 'music-1' } },
    });

    // Switch node
    const switchNode = tree.nodesById['switch-switch-1'];
    expect(switchNode).toBeDefined();
    expect(switchNode.component).toBe('SwitchTile');
    expect(switchNode.props.on).toBe(false);

    // Scene node
    const sceneNode = tree.nodesById['scene-scene-1'];
    expect(sceneNode).toBeDefined();
    expect(sceneNode.component).toBe('SceneTile');
    expect(sceneNode.props.active).toBe(false);

    // Connect node
    const connectNode = tree.nodesById['connect-tile'];
    expect(connectNode).toBeDefined();
    expect(connectNode.component).toBe('ConnectTile');
    expect(connectNode.props.label).toBe('Connect a device');

    // Plan board node
    const planNode = tree.nodesById['plan-board-1'];
    expect(planNode).toBeDefined();
    expect(planNode.component).toBe('PlanBoard');
    expect(planNode.props.boardId).toBe('board-1');
    expect(planNode.props.template).toBe('studio');
  });

  it('updates bound values when updateDataModel message arrives', () => {
    const coerced = coerceSurfacePlan(samplePlan);
    if (!coerced.ok) throw new Error();

    const messages = expandPlan(coerced.value, 'surf-1', initialDevices as never);
    let { state, trees } = reduceA2uiMessages(undefined, messages);

    expect(trees['surf-1'].nodesById['lamp-lamp-1'].props.on).toBe(true);

    // Update lamp state to off and 20% brightness
    const updateMsg = deviceUpdate('surf-1', 'lamp-1', {
      on: false,
      brightness: 20,
      pending: true,
      error: '',
    });

    const next = reduceA2uiMessages(state, [updateMsg]);
    const updatedTree = next.trees['surf-1'];
    const updatedLamp = updatedTree.nodesById['lamp-lamp-1'];

    expect(updatedLamp.props.on).toBe(false);
    expect(updatedLamp.props.brightness).toBe(20);
    expect(updatedLamp.props.pending).toBe(true);
  });

  it('leaves surfaces not targeted by the batch untouched by reference, and does not mutate the previous snapshot', () => {
    const coerced = coerceSurfacePlan(samplePlan);
    if (!coerced.ok) throw new Error();

    const untouchedMessages = expandPlan(coerced.value, 'surf-untouched', initialDevices as never);
    const touchedMessages = expandPlan(coerced.value, 'surf-touched', initialDevices as never);
    const { state: prevState } = reduceA2uiMessages(undefined, [...untouchedMessages, ...touchedMessages]);

    const prevUntouched = prevState.surfaces['surf-untouched'];
    const prevTouchedDataModel = prevState.surfaces['surf-touched'].dataModel;

    const updateMsg = deviceUpdate('surf-touched', 'lamp-1', { on: false, brightness: 10, pending: false, error: '' });
    const next = reduceA2uiMessages(prevState, [updateMsg]);

    // Untouched surface is carried over by reference, not deep-cloned.
    expect(next.state.surfaces['surf-untouched']).toBe(prevUntouched);

    // Touched surface's dataModel was cloned, not mutated in place, and reflects the update.
    expect(next.state.surfaces['surf-touched'].dataModel).not.toBe(prevTouchedDataModel);
    expect((prevTouchedDataModel.devices as Record<string, { on: boolean }>)['lamp-1'].on).toBe(true);
    expect(next.trees['surf-touched'].nodesById['lamp-lamp-1'].props.on).toBe(false);
  });

  it('handles deleteSurface message by removing the surface tree', () => {
    const coerced = coerceSurfacePlan(samplePlan);
    if (!coerced.ok) throw new Error();

    const messages = expandPlan(coerced.value, 'surf-del', initialDevices as never);
    let { state, trees } = reduceA2uiMessages(undefined, messages);
    expect(trees['surf-del']).toBeDefined();

    const deleteMsg = [{ version: 'v0.9' as const, deleteSurface: { surfaceId: 'surf-del' } }];
    const next = reduceA2uiMessages(state, deleteMsg);
    expect(next.trees['surf-del']).toBeUndefined();
  });

  it('createFallbackRenderer manages state and emits onAction', () => {
    const onAction = vi.fn();
    const renderer = createFallbackRenderer({ onAction });

    const coerced = coerceSurfacePlan(samplePlan);
    if (!coerced.ok) throw new Error();

    renderer.processMessages(expandPlan(coerced.value, 'surf-x', initialDevices as never));

    const tree = renderer.getTree('surf-x');
    expect(tree).toBeDefined();
    expect(tree?.nodesById['lamp-lamp-1'].props.brightness).toBe(75);

    // Trigger action through renderer
    renderer.dispatchAction({
      name: 'lamp.brighter',
      context: { deviceId: 'lamp-1' },
    });
    expect(onAction).toHaveBeenCalledWith({
      name: 'lamp.brighter',
      context: { deviceId: 'lamp-1' },
    });
  });

  it('renderTreeToDom renders plain DOM structure without @a2ui/lit', () => {
    const coerced = coerceSurfacePlan(samplePlan);
    if (!coerced.ok) throw new Error();

    const { trees } = reduceA2uiMessages(undefined, expandPlan(coerced.value, 'surf-dom', initialDevices as never));
    const tree = trees['surf-dom'];

    // Mock minimal DOM element for host
    const createdElements: Array<{ tagName: string; className: string; textContent: string }> = [];
    const fakeDoc = {
      createElement: (tag: string) => {
        const el = {
          tagName: tag.toUpperCase(),
          className: '',
          textContent: '',
          style: {},
          dataset: {} as Record<string, string>,
          children: [] as unknown[],
          setAttribute: vi.fn(),
          addEventListener: vi.fn(),
          appendChild: (c: unknown) => {
            el.children.push(c);
          },
        };
        createdElements.push(el);
        return el;
      },
    };

    const host = fakeDoc.createElement('div') as unknown as HTMLElement;
    const dom = renderTreeToDom(tree, host, { doc: fakeDoc as unknown as Document });
    expect(dom).toBeDefined();
    expect(createdElements.length).toBeGreaterThan(5);
  });
});
