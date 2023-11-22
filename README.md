
## Simple raft library and kv-database written in typescript

- Implementation is based on my haskell version for mit distributed systems course. 
- Raft algorithm implements log compaction/fast replication discussed in the paper. 
- Membership changes is not supported in raft library.

### Testing:

#### Local
- build `tsc --project tsconfig.json`
- Testing environment emulates dropped/delayed packages, server crashes and disconnected nodes. 
- Each raft/kv server works as a seperate process.
- Raft state is stored in ./data folder.
- Uses go porcupine library to do linearization check.
- `node ./built/test/test_kv.js` to execute kv tests 
- `node ./built/test/test_raft.js` to execute raft tests 

#### AWS Test

- testing code commissions ec2-instances automatically, configures the environment and run kv-server on ec2.  
- `node .\built\test\test_aws.js` to execute aws tests 
- credentials/region should be configured first  
- change `params` object at .\test\test_aws.js to configure security group/keys
- uses `tc` tool for dropped/delayed packages 
- crashes processes periodically to test durability
 
### TODO: 
- check if AWS Tests still working or not  
- Refactor testing code. 
- Add network partitions to induce split brain 


