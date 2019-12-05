FROM ubuntu:xenial
MAINTAINER jasonlin@11be.org

COPY ./OptractClient.tar.gz /tmp

USER root
RUN groupadd -g 1000 user && \
 useradd -d /data -u 1000 -g 1000 optract

USER optract
RUN mkdir /data/OptractClient && \
 tar xf /tmp/OptractClient.tar.gz -C /data/OptractClient

USER root
RUN rm -fr /tmp/OptractClient.tar.gz

USER optract

EXPOSE 45054
EXPOSE 59437

ENTRYPOINT ["/data/OptractClient/optRun"]
