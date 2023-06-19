
## Simple raft library and kv-database written in javascript 

- Implementation is based on my haskell version for mit distributed systems course. 
- Raft algorithm implements log compaction/fast replication discussed in the paper. 
- Membership changes is not supported in raft library.

### Testing:

#### Local

- Testing environment emulates dropped/delayed packages, server crashes and disconnected nodes. 
- Each raft/kv server works as a seperate process.
- Raft state is stored in ./data folder.
- Uses go porcupine library to do linearization check.
- node `.\test\test_kv.js` to execute kv tests 
- node `.\test\test_raft.js` to execute kv tests 

#### AWS Test
- testing code commissions ec2-instances automatically, configures the environment and run kv-server on ec2.  
- node `.\test\test_aws.js` to execute aws tests 
- credentials/region should be configured first (C:\Users\USER\.aws\credentials)
- change `params` object at .\test\test_aws.js to configure security group/keys
- uses `tc` tool for dropped/delayed packages 
- crashes processes periodically to test durability

### TODO: 
- Refactor testing code. 
- Add network partitions to induce split brain 
