# Motivation

**dsexec** is a cli helper to help you do a **d**ocker **s**ocket exec in a docker service.
**dsexec** will lookup running docker swarm service tasks of the requested **service**, configure a DOCKER_HOST (checking known host & co) context to the remote docker-socket, and spawn you a docker exec of the requested **shell**.



# Installation & Usage
```
# in a docker swarm context
npm install -g dsexec
dsexec [service_name] [shell=/bin/bash]


# make sure you have a docker-socket service available and deployed to all nodes.
```

# SSH host keys

`ds` reaches each node through `DOCKER_HOST=ssh://ds-<NodeID>` and leaves host key
verification to your SSH client. Recommended `~/.ssh/config`:

```
Host *
  StrictHostKeyChecking accept-new
```

Since the docker-socket service shares one host key across nodes, `accept-new`
records each `ds-<NodeID>` once and verifies it afterwards. Earlier releases wrote
`/etc/ssh/ssh_config.d/docker-socket.conf` (`StrictHostKeyChecking no`,
`UserKnownHostsFile /dev/null`); remove that file, `ds` no longer manages it.



# Credits
* [131](https://github.com/131)
