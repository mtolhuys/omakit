# Fixture: privileged argv

Lists running containers. It runs `docker ps` through `sudo`, so the user
needs a passwordless sudo rule for docker or membership of the docker group.
