FROM infwonder/ubuntu-builder as builder
MAINTAINER jasonlin@11be.org

RUN npm install -g asar

RUN mkdir -p /app
COPY package.json /app/
WORKDIR /app

RUN npm install 

FROM ubuntu:xenial
USER root
RUN groupadd -g 1000 user && \
 useradd -m -d /optract -u 1000 -g 1000 optract

RUN apt-get update && apt-get install -y vim

USER optract
COPY --from=builder /app/node_modules /optract/node_modules

RUN mkdir -p /optract/bin /optract/lib /optract/dapps
COPY ./lib /optract/lib/
COPY ./resources/bin /optract/bin
COPY ./dapps /optract/dapps/

WORKDIR /optract

EXPOSE 45054
EXPOSE 59437

ENTRYPOINT ["/optract/bin/node", "./lib/daemon.js"]
