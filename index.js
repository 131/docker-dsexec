#!/usr/local/env cnyks
"use strict";

const os = require('os');
const fs = require('fs');
const path = require('path');

const {spawn} = require('child_process');
const DockerSDK = require('@131/docker-sdk');

const wait  = require('nyks/child_process/wait');
const drain = require('nyks/stream/drain');
const formatArg = require('nyks/process/formatArg');

const DS_SSH_CONFIG = `
Host ds-*
  CheckHostIP no
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
`;

class Dsexec {

  constructor(service_name) {
    this.docker_sdk = new DockerSDK();
    this.shouldCheck_knownhosts = false;
    this.shouldConfigureSSH_config = true;
    this.service_name = service_name;
  }


  async configure_SSH_config() {
    const conf_file = "/etc/ssh/ssh_config.d/docker-socket.conf";
    if(fs.existsSync(conf_file))
      return;
    console.error("Installing ds config in", conf_file);
    fs.writeFileSync(conf_file, DS_SSH_CONFIG);
  }


  async _lookup() {
    if(this.shouldConfigureSSH_config)
      await this.configure_SSH_config();

    console.info("Looking up for '%s' service tasks", this.service_name);
    let services = await this.docker_sdk.services_list({namespace : this.docker_sdk.STACK_NAME, name : new RegExp(this.service_name)});

    if(!services.length)
      throw `Cannot lookup service`;

    let {ID, Spec : {Name}}  = services[0];

    if(services.length > 1)
      console.log("Using first matching service", Name);

    const tasks_list = await this.docker_sdk.service_tasks(ID, 'running');

    const task = tasks_list.shift();
    if(!task)
      throw `No tasks available`;


    const {Status : {State, ContainerStatus : {ContainerID} }, NodeID} = task;
    if(State != "running")
      throw `Cannot exec in non running task`;

    const [ {Description : {Platform : {OS}} , Status : {Addr} } ] = await this.docker_sdk.nodes_list({id: NodeID});

    const isWin = OS == 'windows';

    let host = isWin ? `${Addr}:8022` : `ds-${NodeID}`;

    if(this.shouldCheck_knownhosts || isWin)
      await this.check_knownhosts(host);

    let DOCKER_HOST = "ssh://" + host;
    return {OS, DOCKER_HOST, ContainerID : ContainerID.substr(0, 12)};
  }

  async netshoot(shell = '/bin/bash', ...args) {

    let {DOCKER_HOST, ContainerID} = await this._lookup();
    let exec_args = ["-H", DOCKER_HOST, "run", "-it", "--rm", "--net", `container:${ContainerID}`, 'nicolaka/netshoot', shell, ...args];
    let exec_opts = {stdio : 'inherit'};

    console.log("Entering", ["docker", ...exec_args.map(formatArg)].join(' '));
    let child = spawn("docker", exec_args, exec_opts);
    await wait(child).catch(Function.prototype);
  }


  async exec(shell = '/bin/bash', ...args) {

    let {OS, DOCKER_HOST, ContainerID} = await this._lookup();
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

    let child = spawn("ssh-keyscan", ["-p", port, addr]);
    let [, host_key] = await Promise.all([wait(child), drain(child.stdout)]);

    return String(host_key);
  }

}


module.exports = Dsexec;
