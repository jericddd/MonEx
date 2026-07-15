// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {CatchCard} from "../src/CatchCard.sol";

contract DeployCatchCard is Script {
    function run() external returns (CatchCard card) {
        address deployer = vm.envAddress("DEPLOYER_ADDRESS");
        address minter = vm.envAddress("MINTER_ADDRESS");
        vm.startBroadcast(deployer);
        card = new CatchCard(minter, deployer);
        vm.stopBroadcast();
    }
}
