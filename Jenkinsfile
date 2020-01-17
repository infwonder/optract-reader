def labelBuild = 'docker-builder-jenkins'
def labelTests = 'optract-reader-jenkins'

podTemplate(
  label: labelBuild, 
  containers: [
    containerTemplate(name: 'docker', image: 'docker', ttyEnabled: true, command: 'cat'),
  ],
  volumes: [
    hostPathVolume(mountPath: '/var/run/docker.sock', hostPath: '/var/run/docker.sock')
  ]
) {
  node(labelBuild) {
    def optReader = checkout scm
    stage('Image build') {
      container('docker') {
        withCredentials([usernamePassword(credentialsId: 'dockerhub', usernameVariable: 'username', passwordVariable: 'password')]) {
          sh """
            docker build . -t docker.io/infwonder/optract-reader:k8sdev && \
            docker login -u ${username} -p ${password} && \
            docker push docker.io/infwonder/optract-reader:k8sdev
          """
        }
      }
    }

    stage('Prepare test environment') {
      kubernetesDeploy(
        kubeconfigId: 'kubeconfig',
        configs: 'k8s/optract-ipfs-test.yml',
        deleteResource: true
      )

      kubernetesDeploy(
        kubeconfigId: 'kubeconfig',
        configs: 'k8s/optract-reader-test.yml',
        deleteResource: true
      )

      podTemplate(
        label: labelTests,
        containers: [
          containerTemplate(name: 'optract-reader-test', image: 'infwonder/optract-reader:k8sdev', ttyEnabled: true, command: 'cat')
        ]
      ) {
        node(labelTests) {
          stage('Test drive') {
            container('optract-reader-test') {
              sh """
                /optract/bin/node /optract/lib/tester.js ws://optract-service.default:59437 || exit 1
              """
            }
          }
        }
      }
    }
  }
}
