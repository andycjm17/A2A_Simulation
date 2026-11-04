// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
/// @notice Anchors signed audit heads. Does NOT prove off-chain matching correctness.
contract AuditAnchor {
    address public immutable attestor;
    mapping(bytes32=>mapping(uint256=>bytes32)) public roots;
    event Anchored(bytes32 indexed market,uint256 indexed seq,bytes32 root);
    constructor(address signer){require(signer!=address(0),"signer");attestor=signer;}
    function anchor(bytes32 market,uint256 seq,bytes32 root,bytes calldata signature) external {
        bytes32 digest=keccak256(abi.encode(block.chainid,address(this),market,seq,root));
        require(ECDSA.recover(digest,signature)==attestor,"signature");
        require(seq>0 && root!=bytes32(0),"root");
        require(roots[market][seq]==bytes32(0) || roots[market][seq]==root,"conflicting anchor");
        roots[market][seq]=root;emit Anchored(market,seq,root);
    }
}
