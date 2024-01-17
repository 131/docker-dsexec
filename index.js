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

  async run(service_name, args = ['/bin/bash']) {
    if(this.shouldConfigureSSH_config)
      await this.configure_SSH_config();

    if(!service_name.startsWith(this.docker_sdk.STACK_NAME))
      service_name = `${this.docker_sdk.STACK_NAME}_${service_name}`;
    console.info("Looking up for '%s' service tasks", service_name);
    let services = await this.docker_sdk.services_list({name : service_name});
    if(!services.length)
      throw `Cannot lookup service`;

    let {ID, Spec : {Name}} = services[0];

    if(services.length > 1)
      console.log("Using first matching service", Name);

    const tasks_list = await this.docker_sdk.service_tasks(ID, 'running');

    const task = tasks_list.shift();
    if(!task)
      throw `No tasks available`;

    const {Status : {State, ContainerStatus : {ContainerID} }, NodeID} = task;
    if(State != "running")
      throw `Cannot exec in non running task`;

    let host = `ds-${NodeID}`;

    if(this.shouldCheck_knownhosts)
      await this.check_knownhosts(host);

    let DOCKER_HOST = "ssh://" + host;

    let exec_args = ["-H", DOCKER_HOST, "exec", "-it", ContainerID.substr(0, 12), ...args];
    let exec_opts = {stdio : 'inherit'};
    console.log("Entering", ["docker", ...exec_args.map(formatArg)].join(' '));
    let child = spawn("docker", exec_args, exec_opts);
    await wait(child).catch(Function.prototype);
  }

  async check_knownhosts(addr) {
    console.log("Checking for known host", addr);
    let knownhosts_file = path.join(os.homedir(), '.ssh', 'known_hosts');
    let body = "";
    if(fs.existsSync(knownhosts_file)) {
      let search = new RegExp("^" + addr);
      body = fs.readFileSync(knownhosts_file, 'utf-8');
      if(search.test(body))
        return;
    }

    let hostkey = await this.lookup_hostkeys(addr);
    body += hostkey;
    fs.writeFileSync(knownhosts_file, body);
    console.log("Wrote %s hostkey in %s", addr, knownhosts_file);
  }

  async lookup_hostkeys(addr) {
    let child = spawn("ssh-keyscan", [addr]);
    let [, host_key] = await Promise.all([wait(child), drain(child.stdout)]);

    return String(host_key);
  }

  static async exec(service_name, shell = '/bin/bash', args = []) {
    let i = new Dsexec();
    await i.run(service_name, [shell, ...args]);
  }
}


module.exports = Dsexec;
