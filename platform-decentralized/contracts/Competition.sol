// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice Simulation only. No deposits, withdrawals, upgrades or privileged balance setters.
/// Every accepted order is stored on chain; anyone can execute deterministic settlement.
contract Competition is EIP712 {
    struct Settings { uint256 startAt; uint256 roundSeconds; uint256 rounds; uint256 initialCash; uint256 initialQuantity; }
    struct Order { address owner; uint256 round; uint256 asset; uint256 side; uint256 price; uint256 quantity; bytes32 nonce; uint256 epoch; }
    struct Accepted { Order order; uint256 filled; uint256 cashFlow; }
    bytes32 public constant ORDER_TYPEHASH = keccak256("Order(address owner,uint256 round,uint256 asset,uint256 side,uint256 price,uint256 quantity,bytes32 nonce,uint256 epoch)");
    bytes32 public constant SESSION_TYPEHASH = keccak256("Session(address owner,address key,uint256 expires,uint256 epoch)");
    uint256 public immutable startAt;
    uint256 public immutable roundSeconds;
    uint256 public immutable totalRounds;
    uint256 public immutable initialCash;
    uint256 public immutable initialQuantity;
    bytes32 public immutable rulesHash;
    uint256 public currentRound = 1;
    bool public finished;
    address[] public participants;
    bytes32[] public symbols;
    uint256[] public redemptionPrices;
    mapping(address=>bool) public member;
    mapping(address=>uint256) public cash;
    mapping(address=>mapping(uint256=>uint256)) public holdings;
    mapping(address=>uint256) public reservedCash;
    mapping(address=>uint256) public epoch;
    mapping(address=>address) public sessionKey;
    mapping(address=>uint256) public sessionExpiry;
    mapping(address=>mapping(bytes32=>uint256)) private nonceIndex;
    mapping(uint256=>mapping(address=>mapping(uint256=>bool))) public decided;
    mapping(uint256=>uint256[]) private roundOrders;
    Accepted[] private accepted;
    event OrderAccepted(uint256 indexed index,uint256 indexed round,address indexed owner,bytes32 digest,Order order,bytes signature);
    event Trade(uint256 indexed round,uint256 indexed asset,uint256 buyIndex,uint256 sellIndex,uint256 price,uint256 quantity);
    event RoundSettled(uint256 indexed round,bytes32 stateHash);
    event SessionAuthorized(address indexed owner,address key,uint256 expires,uint256 epoch);
    event Finalized(bytes32 stateHash);

    constructor(address[] memory users,bytes32[] memory assets,uint256[] memory prices,Settings memory s) EIP712("Agent Exchange Competition","1") {
        require(users.length>=2 && users.length<=64,"capacity");
        require(assets.length>=1 && assets.length<=8 && assets.length==prices.length,"assets");
        require(users.length*assets.length<=128,"round capacity");
        require(s.startAt>=block.timestamp+5 && s.roundSeconds>=2 && s.roundSeconds<=60 && s.rounds>=1 && s.rounds<=100,"schedule");
        require(s.initialCash<=1e9 && s.initialQuantity<=100000,"balances");
        startAt=s.startAt;roundSeconds=s.roundSeconds;totalRounds=s.rounds;
        initialCash=s.initialCash;initialQuantity=s.initialQuantity;
        participants=users;symbols=assets;redemptionPrices=prices;
        rulesHash=keccak256(abi.encode("fixed-redemption-v1",users,assets,prices,s));
        for(uint256 a;a<assets.length;a++) {
            require(assets[a]!=bytes32(0) && prices[a]>=100 && prices[a]<=20000,"asset");
            for(uint256 b;b<a;b++)require(assets[a]!=assets[b],"duplicate asset");
        }
        for(uint256 i;i<users.length;i++) {
            address u=users[i];require(u!=address(0) && !member[u],"participant");member[u]=true;cash[u]=s.initialCash;
            for(uint256 a;a<assets.length;a++)holdings[u][a]=s.initialQuantity;
        }
    }
    function authorizeSession(address owner,address key,uint256 expires,uint256 newEpoch,bytes calldata signature) external {
        require(member[owner] && !finished && newEpoch==epoch[owner]+1,"session epoch");
        require(expires>=block.timestamp && expires<=startAt+totalRounds*roundSeconds+1 days,"expiry");
        bytes32 hash=_hashTypedDataV4(keccak256(abi.encode(SESSION_TYPEHASH,owner,key,expires,newEpoch)));
        require(ECDSA.recover(hash,signature)==owner,"owner signature");
        epoch[owner]=newEpoch;sessionKey[owner]=key;sessionExpiry[owner]=expires;
        emit SessionAuthorized(owner,key,expires,newEpoch);
    }
    function orderDigest(Order calldata o) public view returns(bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(ORDER_TYPEHASH,o.owner,o.round,o.asset,o.side,o.price,o.quantity,o.nonce,o.epoch)));
    }
    function submit(Order calldata o,bytes calldata signature) external returns(uint256) {
        require(member[o.owner],"member");
        bytes32 hash=orderDigest(o);
        address signer=ECDSA.recover(hash,signature);
        require(o.epoch==epoch[o.owner] && (signer==o.owner || (signer==sessionKey[o.owner] && block.timestamp<=sessionExpiry[o.owner])),"signature");
        uint256 existing=nonceIndex[o.owner][o.nonce];
        if(existing!=0) {
            require(keccak256(abi.encode(accepted[existing-1].order))==keccak256(abi.encode(o)),"nonce conflict");
            return existing-1;
        }
        require(!finished && o.round==currentRound && o.asset<symbols.length && o.side<=2,"order");
        uint256 opens=startAt+(currentRound-1)*roundSeconds;
        uint256 lockSeconds=roundSeconds/10; if(lockSeconds>5)lockSeconds=5;
        require(block.timestamp>=opens && block.timestamp<opens+roundSeconds-lockSeconds,"window");
        require(!decided[o.round][o.owner][o.asset],"one order per asset");
        if(o.side==0)require(o.price==0 && o.quantity==0,"pass");
        else {
            require(o.price>=100 && o.price<=20000 && o.quantity>=1 && o.quantity<=10,"limits");
            if(o.side==1) {require(cash[o.owner]>=reservedCash[o.owner]+o.price*o.quantity,"cash");reservedCash[o.owner]+=o.price*o.quantity;}
            else require(holdings[o.owner][o.asset]>=o.quantity,"holdings");
        }
        decided[o.round][o.owner][o.asset]=true;
        uint256 index=accepted.length;accepted.push(Accepted(o,0,0));
        nonceIndex[o.owner][o.nonce]=index+1;roundOrders[o.round].push(index);
        emit OrderAccepted(index,o.round,o.owner,hash,o,signature);return index;
    }
    function priority(address owner,uint256 round) public view returns(uint256) {
        return uint256(keccak256(abi.encode(rulesHash,round,owner)));
    }
    function beforeOrder(uint256 x,uint256 y,bool buy) private view returns(bool) {
        Order storage a=accepted[x].order;Order storage b=accepted[y].order;
        if(a.price!=b.price)return buy ? a.price>b.price : a.price<b.price;
        uint256 pa=priority(a.owner,a.round);uint256 pb=priority(b.owner,b.round);
        return pa!=pb ? pa<pb : uint160(a.owner)<uint160(b.owner);
    }
    function sorted(uint256 asset,uint256 side) private view returns(uint256[] memory ids,uint256 n) {
        uint256[] storage all=roundOrders[currentRound];ids=new uint256[](all.length);
        for(uint256 i;i<all.length;i++)if(accepted[all[i]].order.asset==asset && accepted[all[i]].order.side==side) {
            uint256 j=n;
            while(j>0 && beforeOrder(all[i],ids[j-1],side==1)){ids[j]=ids[j-1];j--;}
            ids[j]=all[i];n++;
        }
    }
    function settle() external {
        require(!finished && block.timestamp>=startAt+currentRound*roundSeconds,"not due");
        for(uint256 asset;asset<symbols.length;asset++) {
            (uint256[] memory buys,uint256 bn)=sorted(asset,1);
            (uint256[] memory sells,uint256 sn)=sorted(asset,2);
            uint256 i;uint256 j;
            while(i<bn && j<sn) {
                Accepted storage b=accepted[buys[i]];Accepted storage s=accepted[sells[j]];
                if(b.order.price<s.order.price)break;
                uint256 q=b.order.quantity-b.filled;uint256 sq=s.order.quantity-s.filled;if(sq<q)q=sq;
                uint256 price=(b.order.price+s.order.price)/2;uint256 amount=price*q;
                cash[b.order.owner]-=amount;cash[s.order.owner]+=amount;
                holdings[b.order.owner][asset]+=q;holdings[s.order.owner][asset]-=q;
                b.filled+=q;s.filled+=q;b.cashFlow+=amount;s.cashFlow+=amount;
                emit Trade(currentRound,asset,buys[i],sells[j],price,q);
                if(b.filled==b.order.quantity)i++;if(s.filled==s.order.quantity)j++;
            }
        }
        for(uint256 i;i<participants.length;i++)reservedCash[participants[i]]=0;
        if(currentRound==totalRounds) {
            for(uint256 i;i<participants.length;i++)for(uint256 a;a<symbols.length;a++) {
                cash[participants[i]]+=holdings[participants[i]][a]*redemptionPrices[a];holdings[participants[i]][a]=0;
            }
            finished=true;
        }
        bytes32 root=stateHash();emit RoundSettled(currentRound,root);
        if(finished)emit Finalized(root);else currentRound++;
    }
    function stateHash() public view returns(bytes32 h) {
        h=keccak256(abi.encode(rulesHash,currentRound,finished));
        for(uint256 i;i<participants.length;i++) {
            address u=participants[i];h=keccak256(abi.encode(h,u,cash[u]));
            for(uint256 a;a<symbols.length;a++)h=keccak256(abi.encode(h,holdings[u][a]));
        }
    }
    function getRoundOrders(uint256 round) external view returns(uint256[] memory){return roundOrders[round];}
    function getOrder(uint256 index) external view returns(Accepted memory){return accepted[index];}
    function participantCount() external view returns(uint256){return participants.length;}
    function assetCount() external view returns(uint256){return symbols.length;}
    function orderCount() external view returns(uint256){return accepted.length;}
}
