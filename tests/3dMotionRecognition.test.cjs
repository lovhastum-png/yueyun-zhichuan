const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', '3d-motion-recognition.js'), 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(source, sandbox);
const classify = sandbox.window.YuejuMotionRecognition.classifyGesture;
const extractUpperBodyPose = sandbox.window.YuejuMotionRecognition.extractUpperBodyPose;

function basePose() {
  const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
  points[11] = { x: 0.4, y: 0.35, visibility: 1 };
  points[12] = { x: 0.6, y: 0.35, visibility: 1 };
  points[13] = { x: 0.32, y: 0.44, visibility: 1 };
  points[14] = { x: 0.68, y: 0.44, visibility: 1 };
  points[23] = { x: 0.43, y: 0.65, visibility: 1 };
  points[24] = { x: 0.57, y: 0.65, visibility: 1 };
  return points;
}

test('maps four stable upper-body gestures to Yue Opera movements', () => {
  const water = basePose();
  water[15] = { x: 0.42, y: 0.15, visibility: 1 };
  water[16] = { x: 0.58, y: 0.15, visibility: 1 };

  const cloud = basePose();
  cloud[15] = { x: 0.08, y: 0.41, visibility: 1 };
  cloud[16] = { x: 0.92, y: 0.41, visibility: 1 };

  const orchid = basePose();
  orchid[15] = { x: 0.48, y: 0.48, visibility: 1 };
  orchid[16] = { x: 0.52, y: 0.48, visibility: 1 };

  const salute = basePose();
  salute[15] = { x: 0.34, y: 0.14, visibility: 1 };
  salute[16] = { x: 0.68, y: 0.58, visibility: 1 };

  assert.equal(classify(water), 'water');
  assert.equal(classify(cloud), 'cloud');
  assert.equal(classify(orchid), 'orchid');
  assert.equal(classify(salute), 'salute');
});

test('ignores neutral or low-confidence poses', () => {
  const neutral = basePose();
  neutral[15] = { x: 0.4, y: 0.62, visibility: 1 };
  neutral[16] = { x: 0.6, y: 0.62, visibility: 1 };
  assert.equal(classify(neutral), null);

  neutral[15].visibility = 0.1;
  assert.equal(classify(neutral), null);
});

test('extracts normalized upper-body pose for live avatar retargeting', () => {
  const pose = basePose();
  pose[0] = { x: 0.5, y: 0.2, z: -0.05, visibility: 1 };
  pose[15] = { x: 0.18, y: 0.24, z: -0.08, visibility: 1 };
  pose[16] = { x: 0.82, y: 0.24, z: -0.08, visibility: 1 };
  const tracked = extractUpperBodyPose(pose);
  assert.ok(tracked);
  assert.ok(tracked.left.wrist.x < tracked.left.shoulder.x);
  assert.ok(tracked.right.wrist.x > tracked.right.shoulder.x);
  assert.ok(Number.isFinite(tracked.shoulderTilt));

  pose[13].visibility = 0.1;
  assert.equal(extractUpperBodyPose(pose), null);
});
