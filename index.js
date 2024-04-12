#!/usr/local/env cnyks
"use strict";

const os = require('os');
const fs = require('fs');
const path = require('path');

const {spawn} = require('child_process');
const DockerSDK = require('@131/docker-sdk');

const wait  = require('nyks/child_process/wait');
const passthru = require('nyks/child_process/passthru');
const drain = require('nyks/stream/drain');
const formatArg = require('nyks/process/formatArg');

const DS_SSH_CONFIG = `
Host ds-*
  CheckHostIP no
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
`;

class Ds {

  constructor() {
    this.docker_sdk = new DockerSDK();
    this.shouldCheck_knownhosts = false;
    this.shouldConfigureSSH_config = true;
  }


  async configure_SSH_config() {
    const conf_file = "/etc/ssh/ssh_config.d/docker-socket.conf";
    if(fs.existsSync(conf_file))
      return;
    console.error("Installing ds config in", conf_file);
    fs.writeFileSync(conf_file, DS_SSH_CONFIG);
  }


  async _lookup_service(service_name, container_id = null) {
    if(this.shouldConfigureSSH_config)
      await this.configure_SSH_config();

    console.info("Looking up for '%s' service tasks", service_name);
    let services = await this.docker_sdk.services_list({namespace : this.docker_sdk.STACK_NAME, name : new RegExp(service_name)});

    if(!services.length)
      throw `Cannot lookup service`;

    let {ID, Spec : {Name}}  = services[0];

    if(services.length > 1)
      console.log("Using first matching service", Name);

    let tasks_list = await this.docker_sdk.service_tasks(ID, 'running');

    if(container_id)
      tasks_list = tasks_list.filter(({Status : {ContainerStatus : {ContainerID} }}) => ContainerID.startsWith(container_id));

    const task = tasks_list.shift();
    if(!task)
      throw `No tasks available`;


    const {Status : {State, ContainerStatus : {ContainerID} }, NodeID} = task;
    if(State != "running")
      throw `Cannot exec in non running task`;


    let node = await this._lookup_node({id : NodeID});
    return {...node, ContainerID : ContainerID.substr(0, 12), ServiceName : Name};
  }


  async _lookup_node(filter) {
    const nodes =  await this.docker_sdk.nodes_list(filter);
    if(!nodes.length)
      throw `Unreachable node`;

    const [{ID : NodeID, Description : {Hostname, Platform : {OS}}, Status : {Addr} }] = nodes;

    const isWin = OS == 'windows';
    let host = isWin ? `${Addr}:8022` : `ds-${NodeID}`;

    if(this.shouldCheck_knownhosts || isWin)
      await this.check_knownhosts(host);

    let DOCKER_HOST = "ssh://" + host;
    return {OS, DOCKER_HOST, Hostname};
  }


  async activate(target) {
    if(!target)
      return;

    let DOCKER_HOST, Hostname;

    try {
      ({DOCKER_HOST, Hostname} = await this._lookup_node({name : new RegExp(target)}));
      console.info("Found node '%s'", Hostname);
    } catch(err) {}

    try {
      ({DOCKER_HOST, Hostname, ServiceName} = await this._lookup_service(target));
      console.info("Found service '%s' on node '%s'", ServiceName, Hostname);
    } catch(err) {}

     if(DOCKER_HOST)
      return passthru("bash", ["-l"], {env : {...process.env, DOCKER_HOST, DOCKER_HOSTNAME : Hostname}}).catch(() => true);

  }

  async stats(node_name) {
    if(!node_name)
      throw `Invalid node name`;

    let {DOCKER_HOST, Hostname} = await this._lookup_node({name : new RegExp(node_name)});
    let stats_args = ["-H", DOCKER_HOST, "stats"];
    let stats_opts = {stdio : 'inherit'};

    console.log("Entering", Hostname);
    console.log(["docker", ...stats_args.map(formatArg)].join(' '));
    let child = spawn("docker", stats_args, stats_opts);
    await wait(child).catch(Function.prototype);
  }


  async netshoot(service_name, shell = '/bin/bash', ...args) {

    let {DOCKER_HOST, ContainerID} = await this._lookup_service(service_name);
    let exec_args = ["-H", DOCKER_HOST, "run", "-it", "--rm", "--net", `container:${ContainerID}`, 'nicolaka/netshoot', shell, ...args];
    let exec_opts = {stdio : 'inherit'};

    console.log("Entering", ["docker", ...exec_args.map(formatArg)].join(' '));
    let child = spawn("docker", exec_args, exec_opts);
    await wait(child).catch(Function.prototype);
  }


  async exec(service_name, shell = '/bin/bash', ...args) {
    if(!service_name)
      throw `Invalid service name`;

    let {OS, DOCKER_HOST, ContainerID} = await this._lookup_service(service_name);
    if(OS == 'windows' && shell == '/bin/bash')
      shell = 'cmd.exe';

    let exec_args = ["-H", DOCKER_HOST, "exec", "-it", ContainerID, shell, ...args];
    let exec_opts = {stdio : 'inherit'};
    console.log("Entering", ["docker", ...exec_args.map(formatArg)].join(' '));
    let child = spawn("docker", exec_args, exec_opts);
    await wait(child).catch(Function.prototype);
  }

  async check_knownhosts(host) {
    let [addr, port = 22] = host.split(':');

    console.log("Checking for known host", addr, host);
    let knownhosts_file = path.join(os.homedir(), '.ssh', 'known_hosts');
    let body = "";
    if(fs.existsSync(knownhosts_file)) {
      let search = new RegExp(`^(${host}|\\[${addr}\\]:${port})`, 'm');
      body = fs.readFileSync(knownhosts_file, 'utf-8');

      if(search.test(body))
        return;
    }

    let hostkey = await this.lookup_hostkeys(addr, port);
    body += hostkey;
    fs.writeFileSync(knownhosts_file, body);
    console.log("Wrote %s hostkey in %s", addr, knownhosts_file);
  }

  async lookup_hostkeys(addr, port = 22) {
    let host_key = await exec("ssh-keyscan", ["-p", port, addr]);
    return String(host_key);
  }

}

const exec = async function(...args) {
  let child = spawn(...args);
  let [, body] = await Promise.all([wait(child), drain(child.stdout)]);
  return body;
};

module.exports = Ds;
