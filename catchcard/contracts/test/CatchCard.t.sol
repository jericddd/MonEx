// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CatchCard} from "../src/CatchCard.sol";

contract CatchCardTest is Test {
    CatchCard internal card;
    address internal bot = address(0xB07);
    address internal alice = address(0xA11CE);

    function setUp() public {
        card = new CatchCard(bot, address(this));
    }

    function testRulesVersion() public view {
        assertEq(card.RULES_VERSION(), 1);
    }

    function testMintCard() public {
        bytes32 handle = keccak256("alice");
        vm.prank(bot);
        uint256 id = card.mintCard(alice, 0, 2, handle);
        assertEq(id, 0);
        assertEq(card.ownerOf(0), alice);
        (uint8 speciesId, uint8 rarity, uint8 happiness,, bytes32 hash) = _readCard(0);
        assertEq(speciesId, 0);
        assertEq(rarity, 2);
        assertEq(happiness, 70);
        assertEq(hash, handle);
    }

    function testDailyMintLimit() public {
        vm.startPrank(bot);
        card.mintCard(alice, 1, 0, bytes32("a"));
        card.mintCard(alice, 1, 0, bytes32("a"));
        card.mintCard(alice, 1, 0, bytes32("a"));
        vm.expectRevert(CatchCard.DailyMintLimit.selector);
        card.mintCard(alice, 1, 0, bytes32("a"));
        vm.stopPrank();
    }

    function testFeed() public {
        vm.prank(bot);
        card.mintCard(alice, 3, 1, bytes32("a"));
        vm.prank(alice);
        card.feed(0);
        (,, uint8 happiness,,) = _readCard(0);
        assertEq(happiness, 80);
    }

    function testOnlyMinter() public {
        vm.prank(alice);
        vm.expectRevert(CatchCard.NotMinter.selector);
        card.mintCard(alice, 0, 0, bytes32("x"));
    }

    function _readCard(uint256 tokenId)
        internal
        view
        returns (uint8 speciesId, uint8 rarity, uint8 happiness, uint32 mintDay, bytes32 xHandleHash)
    {
        return card.cards(tokenId);
    }
}
