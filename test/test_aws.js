import { DescribeInstancesCommand, EC2Client, RunInstancesCommand, waitUntilInstanceRunning } from "@aws-sdk/client-ec2";
import { NodeSSH } from 'node-ssh'
import { delay, execute_porcupine, permutations, execute_clients } from "./util.js";

var params = {
    security_group: "sg-067af7bc00c024638", // need to add ingress rule for current ip beforehand,  
    key_name: "raft_test",
    key_path: "./raft_test.pem",
    repository: "https://github.com/ekim-boran/raft-js.git"
}

const ec2 = new EC2Client();

const startServers = async (n) => {
    const config = {
        BlockDeviceMappings: [
            {
                'DeviceName': '/dev/xvda',
                'Ebs': { 'DeleteOnTermination': true, 'VolumeSize': 8, 'VolumeType': 'gp2' },
            },
        ],
        ImageId: 'ami-04e4606740c9c9381',
        InstanceType: 't3.micro',
        MaxCount: n,
        MinCount: n,
        Monitoring: { 'Enabled': false },
        SecurityGroupIds: [params.security_group],
        KeyName: params.key_name,
    }
    const command = new RunInstancesCommand(config);
    const response = await ec2.send(command);
    for (let i of response.Instances) await waitUntilInstanceRunning({ client: ec2 }, { InstanceIds: [i.InstanceId] });
}

const getRunningInstances = async () => {
    const response = await ec2.send(new DescribeInstancesCommand({}));
    const names =
        response.Reservations.flatMap(r => r.Instances).filter(i => i.State.Name == "running").map(i => ({ public_dns: i.PublicDnsName, private_ip: i.PrivateIpAddress, instance_id: i.InstanceId }))
    return names
}

async function install(ssh) {
    let first_time = await ssh.execCommand("test -f './raft-js/hello.js' && echo 0 || echo 1")
    if (first_time.stdout == "1") {
        const commands = [
            "sudo yum install iproute-tc -y",
            "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.3/install.sh | bash",
            '. ~/.nvm/nvm.sh',
            'nvm install --lts',
            "sudo yum install git -y",
            `git clone ${repository}`,
            "sudo tc qdisc add dev ens5 root netem delay 1ms 1ms loss 0%",
        ]
        for (const command of commands) {
            const result = await ssh.execCommand(command)
            console.log(command)
        }
    }
    console.log("install completed")
}

async function crash(ssh) {
    let r = await ssh.execCommand("ps aux | grep 'node ./hello.js' | awk '{print $2}'");
    for (let x of r.stdout.split("\n")) await ssh.execCommand("kill -9 " + x);
}

async function restart(ssh, items) {
    await ssh.exec('node', ['./hello.js', ...items.map(item => `http://${item.private_ip}:9000`)], {
        cwd: 'raft-js',
        onStdout: (chunk) => process.stdout.write(items[0].private_ip + " : " + chunk.toString('utf8')),
        onStderr: (chunk) => process.stdout.write('stderr:' + chunk.toString('utf8')),
    })
}

async function start(args) {
    const ssh = new NodeSSH()
    await ssh.connect({ host: args[0].public_dns, username: 'ec2-user', privateKeyPath: params.key_path })
    await install(ssh)
    await crash(ssh)
    await ssh.execCommand("git -C raft-js pull")
    await ssh.execCommand("cd raft-js; npm install --omit=dev",)
    await ssh.execCommand("rm -rf ./raft-js/data")
    await ssh.execCommand("sudo tc qdisc change dev ens5 root netem delay 10ms 10ms loss 5%",)
    restart(ssh, args)
    return { ...args[0], ssh: ssh }
}

async function crash_random(config) {
    await delay(4000)
    let servers = [...config.servers]
    while (!config.stop) {
        servers.sort(() => 0.5 - Math.random());
        await crash(servers[0].ssh)
        await delay(1000) // cannot immediately kill process 
        restart(servers[0].ssh, servers);
        await delay(1000)
        console.log("restarted", servers[0].public_dns)
    }
}

async function stop_test(config) {
    for (let s of config.servers) {
        s.ssh.connection.end()
        s.ssh.dispose()
    }
}


async function generic_test(nservers, nclients, nactions, nkeys, crash) {
    let instances = await getRunningInstances();
    if (instances.length < nservers) await startServers(nservers - instances.length)
    let servers = await getRunningInstances().then(args => Promise.all(permutations(args).map(start)));
    let config = { stop: false, servers }
    const crashPromise = crash ? crash_random(config).catch(() => { }) : Promise.resolve(1);
    let res = await execute_clients(nclients, servers.map(i => `http://${i.public_dns}:11000`), nactions, nkeys);
    let code = await execute_porcupine(res)
    config.stop = true
    await crashPromise
    stop_test(config)
    if (code == 0) console.log("---------------Test Succeed--------------")
    else console.log("---------Test Failed---------------")
}

await generic_test(3, 3, 100, 5, true)
await generic_test(3, 3, 100, 5, true)