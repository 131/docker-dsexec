"use strict";

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {spawn} = require('node:child_process');
const {test} = require('node:test');

const root = path.join(__dirname, '..');

function loadDs(spawnChild) {
  const module = {exports : {}};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'index.js'), 'utf8'), {
    module,
    process,
    console : {error() {}},
    require(name) {
      if(name === 'child_process')
        return {spawn : spawnChild};
      if(name === '@131/docker-sdk')
        return class{};
      return require(name);
    },
  });
  const Ds = module.exports;
  const ds = new Ds();
  ds._lookup_service = async () => ({OS : 'linux', DOCKER_HOST : 'ssh://test', ContainerID : 'test'});
  return ds;
}

async function cliExit(result) {
  const process = {argv : ['node', 'ds', 'exec', 'gitaly-master'], exitCode : 0};
  let completed;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'bin/ds'), 'utf8'), {
    process,
    console : {error() {}},
    require() {
      return class{
        exec() {
          completed = result();
          return completed;
        }
      };
    },
  });
  await completed.catch(() => {});
  await new Promise(resolve => setImmediate(resolve));
  return process.exitCode;
}

for(const code of [0, 1, 42, 255]) {
  test(`exec and CLI propagate exit code ${code}`, async () => {
    const ds = loadDs(() => spawn(process.execPath, ['-e', `process.exit(${code})`]));
    assert.equal(await ds.exec('gitaly-master'), code);
    assert.equal(await cliExit(() => ds.exec('gitaly-master')), code);
  });
}

test('spawn failure rejects and CLI exits with 1', async () => {
  const ds = loadDs(() => spawn('/nonexistent/dsexec-test-docker', []));
  await assert.rejects(ds.exec('gitaly-master'), {code : 'ENOENT'});
  assert.equal(await cliExit(() => ds.exec('gitaly-master')), 1);
});

test('lookup failure makes CLI exit with 1', async () => {
  const ds = loadDs(() => {
    throw new Error('Docker must not be spawned');
  });
  ds._lookup_service = async () => { throw new Error('Service not found'); };
  ds._lookup_container = async () => { throw new Error('Container not found'); };
  assert.equal(await cliExit(() => ds.exec('missing-service')), 1);
});

test('signal termination makes CLI exit with 1 rather than success', async () => {
  const ds = loadDs(() => spawn(process.execPath, ['-e', 'process.kill(process.pid, "SIGTERM")']));
  assert.equal(await ds.exec('gitaly-master'), null);
  assert.equal(await cliExit(() => ds.exec('gitaly-master')), 1);
});
