node {
  stage("Github checkout") {
    checkout scm
  }
  stage("Docker build") {
    docker.build("infwonder/optract-reader").push()
  }
}
