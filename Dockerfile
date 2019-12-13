FROM infwonder/ubuntu-builder as builder
MAINTAINER jasonlin@11be.org

RUN npm install -g asar

RUN mkdir -p /app
COPY package.json /app/
WORKDIR /app

RUN npm install 
RUN mkdir -p /app/lib /app/resources /app/dapps
RUN ls -l /app
COPY ./lib /app/lib/
COPY ./resources /app/resources/
COPY ./dapps /app/dapps/

RUN npm run release

FROM ubuntu:xenial
COPY --from=builder /app/OptractClient.tar.gz /tmp

USER root
RUN groupadd -g 1000 user && \
 useradd -m -d /data -u 1000 -g 1000 optract

USER optract
RUN mkdir /data/OptractClient && \
 tar xf /tmp/OptractClient.tar.gz -C /data/OptractClient

USER root
RUN rm -fr /tmp/OptractClient.tar.gz

USER optract
WORKDIR /data/OptractClient/dist

EXPOSE 45054
EXPOSE 59437

ENTRYPOINT ["/data/OptractClient/dist/optRun"]
