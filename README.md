# Screwdriver Kubernetes VM Executor
[![Version][npm-image]][npm-url] ![Downloads][downloads-image] [![Build Status][status-image]][status-url] [![Open Issues][issues-image]][issues-url] [![Dependency Status][daviddm-image]][daviddm-url] ![License][license-image]

> Kubernetes VM Executor plugin for Screwdriver

## Usage

```bash
npm install screwdriver-executor-k8s-vm
```

### Initialization
The class provides a couple options that are configurable in the instantiation of this Executor

| Parameter        | Type  | Default    | Description |
| :-------------   | :---- | :----------| :-----------|
| config        | Object | | Configuration Object |
| config.kubernetes | Object | {} | Kubernetes configuration Object |
| config.kubernetes.token | String | '' | The JWT token used for authenticating to the Kubernetes cluster. (If not passed in, we will read from `/var/run/secrets/kubernetes.io/serviceaccount/token`.) |
| config.kubernetes.host | String | 'kubernetes.defaults' | The hostname for the Kubernetes cluster (kubernetes) |
| config.kubernetes.nodeSelectors| Object | | Object representing node label-value pairs https://kubernetes.io/docs/concepts/configuration/assign-pod-node/#step-one-attach-label-to-the-node|
| config.ecosystem | Object | | Screwdriver Ecosystem (ui, api, store, pushgateway, etc.) |
| config.launchVersion | String | 'stable' | Launcher container version to use (stable) |
| config.prefix | String | '' |Prefix to container names ("") |
| config.jobsNamespace | String | 'default' | Kubernetes namespace where builds are running on |
| config.baseImage | String | '' | Base image used to start the VM |
| config.kubernetes.resources.memory.high | Number | 6 | Value for HIGH memory (in GB) |
| config.kubernetes.resources.memory.low | Number | 2 | Value for LOW memory (in GB) |
| config.kubernetes.resources.memory.micro | Number | 1 | Value for MICRO memory (in GB) |
| config.kubernetes.resources.cpu.high | Number | 12 | Value for HIGH CPU (in cores) |
| config.kubernetes.resources.cpu.low | Number | 2 | Value for LOW CPU (in cores) |
| config.kubernetes.resources.cpu.micro | Number | 1 | Value for MICRO CPU (in cores) |

### Methods

For more information on `start`, `stop`, and `stats` please see the [executor-base-class].

## Testing

```bash
npm test
```

## License

Code licensed under the BSD 3-Clause license. See LICENSE file for terms.

[npm-image]: https://img.shields.io/npm/v/screwdriver-executor-k8s-vm.svg
[npm-url]: https://npmjs.org/package/screwdriver-executor-k8s-vm
[downloads-image]: https://img.shields.io/npm/dt/screwdriver-executor-k8s-vm.svg
[license-image]: https://img.shields.io/npm/l/screwdriver-executor-k8s-vm.svg
[issues-image]: https://img.shields.io/github/issues/screwdriver-cd/executor-k8s-vm.svg
[issues-url]: https://github.com/screwdriver-cd/executor-k8s-vm/issues
[status-image]: https://cd.screwdriver.cd/pipelines/235/badge
[status-url]: https://cd.screwdriver.cd/pipelines/235
[daviddm-image]: https://david-dm.org/screwdriver-cd/executor-k8s-vm.svg?theme=shields.io
[daviddm-url]: https://david-dm.org/screwdriver-cd/executor-k8s-vm
