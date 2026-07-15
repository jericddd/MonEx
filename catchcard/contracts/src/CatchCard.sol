// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title CatchCard — mint-on-X collectible cards (Frozen Rules v1)
/// @notice Bot-only mint; users feed their own tokens on-chain.
contract CatchCard is ERC721, Ownable {
    uint8 public constant RULES_VERSION = 1;
    uint8 public constant SPECIES_COUNT = 8;
    uint8 public constant RARITY_LEGENDARY = 3;
    uint8 public constant HAPPINESS_START = 70;
    uint8 public constant HAPPINESS_MAX = 100;
    uint8 public constant HAPPINESS_PER_FEED = 10;
    uint8 public constant MINTS_PER_WALLET_PER_DAY = 3;
    uint8 public constant FEEDS_PER_TOKEN_PER_DAY = 1;

    struct Card {
        uint8 speciesId;
        uint8 rarity;
        uint8 happiness;
        uint32 mintDay;
        bytes32 xHandleHash;
    }

    uint256 private _nextTokenId;
    address public minter;

    mapping(uint256 => Card) public cards;
    mapping(address => mapping(uint32 => uint8)) public mintsOnDay;
    mapping(uint256 => mapping(uint32 => uint8)) public feedsOnDay;

    event CardMinted(
        address indexed to,
        uint256 indexed tokenId,
        uint8 speciesId,
        uint8 rarity,
        bytes32 xHandleHash
    );
    event CardFed(address indexed owner, uint256 indexed tokenId, uint8 happiness);

    error NotMinter();
    error InvalidSpecies();
    error InvalidRarity();
    error DailyMintLimit();
    error DailyFeedLimit();
    error HappinessMax();

    modifier onlyMinter() {
        if (msg.sender != minter) revert NotMinter();
        _;
    }

    constructor(address minter_, address owner_) ERC721("CatchCard", "CARD") Ownable(owner_) {
        minter = minter_;
    }

    function setMinter(address minter_) external onlyOwner {
        minter = minter_;
    }

    function mintsToday(address wallet) external view returns (uint8) {
        return mintsOnDay[wallet][_utcDay()];
    }

    function mintCard(
        address to,
        uint8 speciesId,
        uint8 rarity,
        bytes32 xHandleHash
    ) external onlyMinter returns (uint256 tokenId) {
        if (speciesId >= SPECIES_COUNT) revert InvalidSpecies();
        if (rarity > RARITY_LEGENDARY) revert InvalidRarity();

        uint32 day = _utcDay();
        if (mintsOnDay[to][day] >= MINTS_PER_WALLET_PER_DAY) revert DailyMintLimit();

        mintsOnDay[to][day] += 1;
        tokenId = _nextTokenId++;
        _safeMint(to, tokenId);

        cards[tokenId] = Card({
            speciesId: speciesId,
            rarity: rarity,
            happiness: HAPPINESS_START,
            mintDay: day,
            xHandleHash: xHandleHash
        });

        emit CardMinted(to, tokenId, speciesId, rarity, xHandleHash);
    }

    function feed(uint256 tokenId) external {
        address owner = ownerOf(tokenId);
        if (msg.sender != owner) revert OwnableUnauthorizedAccount(msg.sender);

        uint32 day = _utcDay();
        if (feedsOnDay[tokenId][day] >= FEEDS_PER_TOKEN_PER_DAY) revert DailyFeedLimit();

        Card storage card = cards[tokenId];
        uint16 next = uint16(card.happiness) + HAPPINESS_PER_FEED;
        if (next > HAPPINESS_MAX) revert HappinessMax();
        card.happiness = uint8(next);
        feedsOnDay[tokenId][day] += 1;

        emit CardFed(owner, tokenId, card.happiness);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        Card memory card = cards[tokenId];
        string memory rarityName = _rarityName(card.rarity);
        string memory json = string.concat(
            '{"name":"CatchCard #',
            _toString(tokenId),
            '","description":"Minted via @CatchCard on X","attributes":[',
            '{"trait_type":"Species","value":',
            _toString(card.speciesId),
            "},",
            '{"trait_type":"Rarity","value":"',
            rarityName,
            '"},',
            '{"trait_type":"Happiness","value":',
            _toString(card.happiness),
            "},",
            '{"trait_type":"RulesVersion","value":',
            _toString(RULES_VERSION),
            "}]}"
        );
        return string.concat("data:application/json;utf8,", json);
    }

    function _utcDay() internal view returns (uint32) {
        return uint32(block.timestamp / 1 days);
    }

    function _rarityName(uint8 rarity) internal pure returns (string memory) {
        if (rarity == 0) return "Common";
        if (rarity == 1) return "Uncommon";
        if (rarity == 2) return "Rare";
        return "Legendary";
    }

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + (value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}
