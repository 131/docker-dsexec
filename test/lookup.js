"use strict";

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const containerID = 'abcdef0123456789';
const active = {
  NodeID : 'test-node',
  Status : {State : 'running', ContainerStatus : {ContainerID : containerID}},
};

function loadDs(tasks) {
  const module = {exports : {}};
  vm.runInNewContext(source, {
    module,
    process,
    console : {error() {}},
    require(name) {
      if(name === '@131/docker-sdk')
        return class{};
      return require(name);
    },
  });
  const Ds = module.exports;
  const ds = new Ds();
  ds.docker_sdk.tasks_list = async ({state}) => {
    assert.equal(state, 'running');
    return tasks;
  };
  ds.docker_sdk.services_list = async () => [{ID : 'test-service-id', Spec : {Name : 'test-service'}}];
  ds.docker_sdk.service_tasks = async (service, state) => {
    assert.equal(service, 'test-service-id');
    assert.equal(state, 'running');
    return tasks;
  };
  ds._lookup_node = async ({id}) => {
    assert.equal(id, 'test-node');
    return {OS : 'linux', DOCKER_HOST : 'ssh://test-node'};
  };
  return ds;
}

const lookups = [
  ['container prefix', ds => ds._lookup_container('abcdef'), "No running container matches 'abcdef'"],
  ['service', ds => ds._lookup_service('test-service'), "No matching running container in service 'test-service'"],
  ['service with container prefix', ds => ds._lookup_service('test-service', 'abcdef'), "No matching running container in service 'test-service'"],
];

const unavailable = [
  ['preparing task without ContainerStatus', {Status : {State : 'preparing'}}],
  ['running task without ContainerStatus', {Status : {State : 'running'}}],
  ['running task without ContainerID', {Status : {State : 'running', ContainerStatus : {}}}],
  ['starting task with matching ContainerID', {Status : {State : 'starting', ContainerStatus : {ContainerID : containerID}}}],
  ['shutdown task with matching ContainerID', {Status : {State : 'shutdown', ContainerStatus : {ContainerID : containerID}}}],
];

for(const [name, lookup] of lookups) {
  for(const [description, task] of unavailable) {
    test(`${name} skips ${description} and finds the active container`, async () => {
      const result = await lookup(loadDs([task, active]));
      assert.equal(result.ContainerID, containerID.substr(0, 12));
      assert.equal(result.DOCKER_HOST, 'ssh://test-node');
      if(name !== 'container prefix')
        assert.equal(result.ServiceName, 'test-service');
    });
  }
}

for(const [name, lookup, message] of lookups) {
  for(const [description, tasks] of [
    ['empty task list', []],
    ['only unavailable tasks', unavailable.map(([, task]) => task)],
  ]) {
    test(`${name} reports a clear error for ${description}`, async () => {
      const ds = loadDs(tasks);
      ds._lookup_node = async () => { throw new Error('No node must be contacted'); };
      await assert.rejects(lookup(ds), error => error === message);
    });
  }
}

for(const [name] of [lookups[0], lookups[2]]) {
  test(`${name} rejects a non-matching active container`, async () => {
    const ds = loadDs([active]);
    let request;
    if(name === 'container prefix')
      request = ds._lookup_container('ffffff');
    else
      request = ds._lookup_service('test-service', 'ffffff');
    await assert.rejects(request, error => typeof error === 'string' && error.includes('running container'));
  });
}

test('service lookup keeps the first active replica and preserves prefix selection', async () => {
  const first = {...active, Status : {State : 'running', ContainerStatus : {ContainerID : '1111111111111111'}}};
  const ds = loadDs([unavailable[0][1], first, active]);
  assert.equal((await ds._lookup_service('test-service')).ContainerID, '111111111111');
  assert.equal((await ds._lookup_service('test-service', 'abcdef')).ContainerID, containerID.substr(0, 12));
});
