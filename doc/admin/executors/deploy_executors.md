# Deploying Sourcegraph executors

<aside class="beta">
<p>
<span class="badge badge-beta">Beta</span> This feature is in beta and might change in the future.
</p>

<p><b>We're very much looking for input and feedback on this feature.</b> You can either <a href="https://about.sourcegraph.com/contact">contact us directly</a>, <a href="https://github.com/sourcegraph/sourcegraph">file an issue</a>, or <a href="https://twitter.com/sourcegraph">tweet at us</a>.</p>
</aside>

[Executors](index.md) provide a sandbox that can run resource-intensive or untrusted tasks on behalf of the Sourcegraph instance, such as:

- [Automatically indexing a repository for precise code navigation](../../code_navigation/explanations/auto_indexing.md)
- [Running batch changes](../../batch_changes/explanations/server_side.md)

> NOTE: Executors are available with no additional setup required on Sourcegraph Cloud.

## Requirements

Executors by default use KVM-based micro VMs powered by [Firecracker](https://github.com/firecracker-microvm/firecracker) in accordance with our [sandboxing model](index.md#how-it-works) to isolate jobs from each other and the host.
This requires executors to be run on machines capable of running Linux KVM extensions. On the most popular cloud providers, this either means running executors on bare-metal machines (AWS) or machines capable of nested virtualization (GCP).

Optionally, executors can be run without using KVM-based isolation, which is less secure but might be easier to run on common machines.

### Resource Recommendations

It is recommended to set the resources based on the number of jobs an instance will process in parallel.

A single job should have the following resources available.

- **CPU:** 4
- **Memory:** 12GB
- **Disk:** 20GB

So, if you expect an Executor instance to process up to 4 jobs in parallel, the recommended resources for the machine are

- **CPU:** 16
- **Memory:** 48GB
- **Disk:** 80GB

The above recommended resources can be changed to fit your constraints. See below for configuring resources for a Job.

<sub>Note: the smallest machine type on AWS that can support Executors with Firecracker is `c5n.metal` (72 vCPU and
192GB of Memory), but concurrency can be turned up for the additional cost.</sub>

#### Job Configuration

The maximum number of Jobs an Executor instance can run in parallel is configured by the Environment Variable `EXECUTOR_MAXIMUM_NUM_JOBS`.

The CPU and Memory usage of an individual Job is configured by the Environment Variables `EXECUTOR_JOB_NUM_CPUS`
and `EXECUTOR_JOB_MEMORY`. 

See [Environment Variables](./deploy_executors_binary.md#step-2-setup-environment-variables) for additional Environment Variables.

<sub>Note: changing CPU and Memory for jobs will affect the overall requirements for an Executor instance.</sub>

#### AWS

It is recommended to add the following **Disk** configuration in AWS.

- **IOPS:** Equal to the Disk Size (so if **Disk** is 100GB, then IOPS is 100)
- **Throughput:** 125MiB/s

### Supported Infrastructures

- **Operating System:** Linux-based
- **Architecture:** AMD64

#### Firecracker Requirements

To run Executors with Firecracker enabled requires the machine to support [Kernel-based Virtual Machine](https://en.wikipedia.org/wiki/Kernel-based_Virtual_Machine).
See [deploying Executors binary](./deploy_executors_binary.md) for additional information on configuring Linux Machines. 

##### Cloud Providers

Machines on Cloud Providers have additional constraints for use with firecracker.

- **AWS:** machine type must be
  a [metal instance (`.metal`)](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instance-types.html)
- **GCP:** the instance
  must [enable nested virtualization](https://cloud.google.com/compute/docs/instances/nested-virtualization/enabling)

## Configure Sourcegraph

Executors must be run separately from your Sourcegraph instance.

Since they must still be able to reach the Sourcegraph instance in order to dequeue and perform work, requests between the Sourcegraph instance and the executors are authenticated via a shared secret.

Before starting any executors, generate an arbitrary secret string (with at least 20 characters) and [set it as the `executors.accessToken` key in your Sourcegraph instance's site-config](../config/site_config.md#view-and-edit-site-configuration).

## Executor installation

Once the shared secret is set in Sourcegraph, you can start setting up executors that can use that access token to talk to the Sourcegraph instance.

### Supported installation types

<div class="grid">
  <a class="btn-app btn" href="/admin/deploy_executors_terraform">
    <h3>Terraform</h3>
    <p>Simply launch executors on AWS or GCP using Sourcegraph-maintained modules and machine images.</p>
    <p>Supports auto scaling.</p>
  </a>
  <a class="btn-app btn" href="/admin/deploy_executors_binary">
    <h3>Install executor on your machine</h3>
    <p>Run executors on any linux amd64 machine.</p>
  </a>
</div>

<div class="grid">
  <a class="btn-app btn" href="/admin/deploy_executors_kubernetes">
    <h3>Kubernetes</h3>
    <p>Run executors on kubernetes</p>
    <p>Requires privileged access to a container runtime.</p>
  </a>
  <a class="btn-app btn" href="/admin/deploy_executors_docker">
    <h3>Docker Compose</h3>
    <p>Run executors on any linux amd64 machine with docker-compose</p>
    <p>Requires privileged access to a container runtime.</p>
  </a>
</div>

## Confirm executors are working

If executor instances boot correctly and can authenticate with the Sourcegraph frontend, they will show up in the _Executors_ page under _Site Admin_ > _Maintenance_.

![Executor list in UI](https://storage.googleapis.com/sourcegraph-assets/docs/images/code-intelligence/sg-3.34/executor-ui-test.png)

## Using private registries

If you want to use docker images stored in a private registry that requires authentication, follow this section to configure it.

Depending on the executor runtime that is being used, different options exist for provisioning access to private container registries:

- Through a special secret called `DOCKER_AUTH_CONFIG`, set in [executor secrets](./executor_secrets.md) in Sourcegraph.
- Through the `EXECUTOR_DOCKER_AUTH_CONFIG` environment variable (also available as a variable in the terraform modules for executors).
- Through the [`config.json` file in `~/.docker`](https://docs.docker.com/engine/reference/commandline/login/). **If using executors with firecracker enabled (recommended) this option is not available.**

When multiple of the above options are combined, executors will use them in the following order:

- If a `DOCKER_AUTH_CONFIG` executor secret is configured, that will be preferred. That is so that users can overwrite the credentials being used in their user-settings. This is the only option available in Sourcegraph Cloud.
- If the `EXECUTOR_DOCKER_AUTH_CONFIG` environment variable is set, this will be used as the next option.
- Finally, if neither of the above are set, executors will fall back to the `config.json` file in the user home directory of the user that is owning the executor process. NOTE: This is not available in the firecracker runtime, as the rootfs is not shared with the host.

The docker CLI supports three ways to use credentials:

- Using static credentials
- Using [credential helpers](https://docs.docker.com/engine/reference/commandline/login/#credential-helpers)
- Using [credential stores](https://docs.docker.com/engine/reference/commandline/login/#credentials-store)

Credential helpers and credential stores are only available for use with the `config.json` configuration option, as they require additional infrastructural changes. Thus, those options are not available on Sourcegraph Cloud.

### Using static credentials

The `EXECUTOR_DOCKER_AUTH_CONFIG` environment variable and the `DOCKER_AUTH_CONFIG` secret expect a docker config with only the necessary properties set for configuring authentication.
The format of this config supports multiple registries to be configured and looks like this:

```json
{
  "auths": {
    "myregistry.example.com[:port]": {
      "auth": "base64(username:password)"
    },
    "myregistry2.example.com[:port]": {
      "auth": "base64(username:password)"
    }
  }
}
```

You can either create this config yourself by hand, or let docker do it for you by running:

```bash
TMP_FILE="$(mktemp -d)" bash -c 'echo "<password>" | docker --config "${TMP_FILE}" login --username "<username>" --password-stdin "<registryurl>" && cat "${TMP_FILE}/config.json" && rm -rf "${TMP_FILE}"'
```

> NOTE: This doesn't work on Docker for Mac if "Securely store Docker logins in macOS keychain" is enabled, as it would store it in the credentials store instead.

You can also run the following:

```bash
echo "username:password" | base64
```

and then paste the result of that into a JSON string like this:

```json
{
  "auths": {
    "myregistry.example.com[:port]": {
      "auth": "<the value from above>"
    }
  }
}
```

For Google Container Registry, [follow this guide](https://cloud.google.com/container-registry/docs/advanced-authentication#json-key) for how to obtain long-lived static credentials.

### Configuring the auth config for use in executors

Now that the config has been obtained, it can be used for the `EXECUTOR_DOCKER_AUTH_CONFIG` environment variable (and terraform variable `docker_auth_config`) or you can create an [executor secret](./executor_secrets.md#creating-a-new-secret) called `DOCKER_AUTH_CONFIG`. Global executor secrets will be available to every execution, while user and organization level executor secrets will only be available to the namespaces executions.
