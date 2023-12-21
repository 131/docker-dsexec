#!/usr/local/env cnyks
"use strict";

const os = require('os');
const fs = require('fs');
const path = require('path');

const {spawn} = require('child_process');
const DockerSDK = require('@131/docker-sdk');

const wait  = require('nyks/child_process/wait');
const drain = require('nyks/stream/drain');

class Dsexec {

  constructor() {
    this.docker_sdk = new DockerSDK();
    this.shouldCheck_knownhosts = false;
  }



  async run(service_name, shell = '/bin/bash') {
    if(!service_name.startsWith(this.docker_sdk.STACK_NAME))
      service_name = `${this.docker_sdk.STACK_NAME}_${service_name}`;
    console.info("Looking up for '%s' service tasks", service_name);
    let services = await this.docker_sdk.services_list({name : service_name});
    if(services.length != 1)
      throw `Cannot lookup service`;

    let {ID} = services[0];

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

    let args = ["-H", DOCKER_HOST, "exec", "-it", ContainerID.substr(0, 12), shell];
    let opts = {stdio : 'inherit'};
    console.log("Entering", ["docker", ...args].join(' '));
    let child = spawn("docker", args, opts);
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

  static async exec(service_name, shell = '/bin/bash') {
    let i = new Dsexec();
    await i.run(service_name, shell);
  }
}


module.exports = Dsexec;
