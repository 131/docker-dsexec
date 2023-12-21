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

# Configuring ssh_config
```
cat <<EOS > /etc/ssh/ssh_config.d/docker-socket.conf
Host ds-*
  CheckHostIP no
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
EOS

```



# Credits
* [131](https://github.com/131)
