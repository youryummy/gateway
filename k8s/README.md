> **Warning**
> In order for the gateway to scan the network faster, it is needed to assign the POD CIDR to a /24 network (see [this post](https://github.com/docker/roadmap/issues/237#issuecomment-962961948) in case you are using Docker Desktop built-in cluster).
> **IMPORTANT:** Cluster IP Range (see [this post](https://stackoverflow.com/questions/64758012/location-of-kubernetes-config-directory-with-docker-desktop-on-windows) for Docker Desktop config) must be set the same as POD CIDR Range

## Environment
Needed values:
* global.node_env (default: production)
* global.jwt_secret
* global.jwt_issuer

Optional values:
* global.namespaceOverride - Override the default namespace
* jwt_role_binding - Attribute in the JWT payload representing the role (default: role)
* sla_sec_scheme - Security Scheme declared in OAS Doc to be used for rate limiting (default: apikey)
* image - Docker image that will run inside the pod (default: "youryummy-account-service:latest")

## Setup development environment with HELM
1.- Prerequisites
* A kubernetes cluster
* Helm

2.- Create a values.yaml file containing:
```yaml
    global:
        node_env: development
        jwt_secret: mysecret 
        jwt_issuer: myissuer

    account-service:
        mongo_host: host.docker.internal # Assuming the k8s is the one provided by Docker-Desktop
        mongo_port: 27017
        mongo_dbname: test-db
        cookie_domain: localhost
```

3.- Create the namespace
```sh
kubectl create namespace <namespace>
```

4.- Install the chart
```sh
helm install -f values.yaml youryummy ./accounts-service/k8s/
```