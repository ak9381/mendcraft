import { describe, expect, it } from 'vitest';
import { classifyGesture } from '../src/input/gestures';
import { buildHandPose, buildScene, DEMO_POSES } from '../src/dev/trackingSim';

describe('trackingSim synthetic poses', () => {
  it('classifies each demo pose as itself', () => {
    expect(classifyGesture(buildHandPose('open'))).toBe('open-palm');
    expect(classifyGesture(buildHandPose('point'))).toBe('point');
    expect(classifyGesture(buildHandPose('pinch'))).toBe('pinch');
    expect(classifyGesture(buildHandPose('thumbs-up'))).toBe('thumbs-up');
    expect(classifyGesture(buildHandPose('fist'))).toBe('fist');
  });

  it('builds a full 21-point hand for every pose', () => {
    for (const pose of DEMO_POSES) {
      expect(buildHandPose(pose)).toHaveLength(21);
    }
  });

  it('places the scene operator face as facing except in the point scene', () => {
    expect(buildScene('open').faces[0].facing).toBe(true);
    expect(buildScene('point').faces[0].facing).toBe(false);
  });

  it('adds a dim stranger face in the crowd variant', () => {
    const scene = buildScene('open', 'crowd');
    expect(scene.faces).toHaveLength(2);
    expect(scene.faces[1].isOperator).toBe(false);
    expect(scene.faces[1].dim).toBe(true);
  });
});
