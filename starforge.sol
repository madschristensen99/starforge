// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./contracts/interfaces/registries/IIPAssetRegistry.sol";
import "./contracts/interfaces/modules/licensing/ILicensingModule.sol";
import "./contracts/interfaces/modules/royalty/IRoyaltyModule.sol";
import "./contracts/interfaces/ILicenseToken.sol";
import "./contracts/interfaces/IGroupNFT.sol";

contract StarForge is ERC721, Ownable {
    using Counters for Counters.Counter;
    using SafeERC20 for IERC20;

    Counters.Counter private _movieIds;

    struct Movie {
        string actors;
        string prompt;
        string link;
        uint256 licenseTokenId;
        address creator;
    }

    mapping(uint256 => Movie) public movies;
    mapping(address => uint256) public actorLicenses;

    IIPAssetRegistry public ipAssetRegistry;
    ILicensingModule public licensingModule;
    IRoyaltyModule public royaltyModule;
    ILicenseToken public licenseToken;
    IGroupNFT public actorGroup;
    IERC20 public storyUSD;

    uint256 public movieCreationFee;
    uint256 public constant PLATFORM_SHARE = 90;
    uint256 public constant ACTOR_SHARE = 10;

    event MovieCreated(uint256 indexed movieId, address creator, string actors, string prompt);
    event MovieLinkUpdated(uint256 indexed movieId, string newLink);
    event ActorLicenseCreated(address indexed actor, uint256 licenseId);
    event MovieCreationFeeUpdated(uint256 newFee);
    event RoyaltyPaid(uint256 indexed movieId, address indexed recipient, uint256 amount);

    constructor(uint256 _initialMovieCreationFee) ERC721("StarForge", "STAR") Ownable(msg.sender) {
        ipAssetRegistry = IIPAssetRegistry(0x1a9d0d28a0422F26D31Be72Edc6f13ea4371E11B);
        licensingModule = ILicensingModule(0xd81fd78f557b457b4350cB95D20b547bFEb4D857);
        royaltyModule = IRoyaltyModule(0x3C27b2D7d30131D4b58C3584FD7c86e3358744de);
        licenseToken = ILicenseToken(0xc7A302E03cd7A304394B401192bfED872af501BE);
        actorGroup = IGroupNFT(0x597e36b678F99229cBc088dD12D24e2A8D562421);
        storyUSD = IERC20(0x91f6F05B08c16769d3c85867548615d270C42fC7);
        movieCreationFee = _initialMovieCreationFee;
    }

    function createMovie(string memory actors, string memory prompt) public returns (uint256) {
        storyUSD.safeTransferFrom(msg.sender, address(this), movieCreationFee);
    
        _movieIds.increment();
        uint256 newMovieId = _movieIds.current();
        _safeMint(msg.sender, newMovieId);

        // Register the movie as an IP Asset
        ipAssetRegistry.register(block.chainid, address(this), newMovieId);

        address[] memory actorAddresses = parseActors(actors);
        uint256 actorCount = actorAddresses.length;

        // Create the beneficiaries array with actors and platform
        address[] memory allBeneficiaries = new address[](actorCount + 1);
        uint256[] memory shares = new uint256[](actorCount + 1);

        // Set up actor shares
        uint256 totalActorShare = actorCount > 0 ? ACTOR_SHARE : 0;
        uint256 individualActorShare = actorCount > 0 ? totalActorShare / actorCount : 0;
        for (uint i = 0; i < actorCount; i++) {
            allBeneficiaries[i] = actorAddresses[i];
            shares[i] = individualActorShare;
        }

        // Set up platform share (last in the array)
        allBeneficiaries[actorCount] = owner();
        shares[actorCount] = PLATFORM_SHARE;

        bytes memory royaltyContext = abi.encode(allBeneficiaries, shares);
/*
        // Mint a license token for the creator
        uint256 licenseTokenId = licensingModule.mintLicenseTokens(
            address(this),
            address(0), // set this
            0, // License terms ID (you may need to set this appropriately)
            1,
            msg.sender,
            royaltyContext
        );

        movies[newMovieId] = Movie(actors, prompt, "", licenseTokenId, msg.sender);
*/
        emit MovieCreated(newMovieId, msg.sender, actors, prompt);

        return newMovieId;
    }

    function createActorLicense(address actor, address licenseTemplateAddress, uint256 licenseTermsId, uint256 amount, bytes calldata royaltyContext) public onlyOwner {
        uint256 licenseId = licensingModule.mintLicenseTokens(
            address(actorGroup),
            licenseTemplateAddress,
            licenseTermsId,
            amount,
            actor,
            royaltyContext
        );
        actorLicenses[actor] = licenseId;
        emit ActorLicenseCreated(actor, licenseId);
    }


    function setMovieCreationFee(uint256 _newFee) public onlyOwner {
        movieCreationFee = _newFee;
        emit MovieCreationFeeUpdated(_newFee);
    }

    function updateMovieLink(uint256 movieId, string memory newLink) public onlyOwner {
        require(_exists(movieId), "Movie does not exist");
        movies[movieId].link = newLink;
        emit MovieLinkUpdated(movieId, newLink);
    }

    function getMovie(uint256 movieId) public view returns (string memory, string memory, string memory, uint256, address) {
        require(_exists(movieId), "Movie does not exist");
        Movie storage movie = movies[movieId];
        return (movie.actors, movie.prompt, movie.link, movie.licenseTokenId, movie.creator);
    }

    function getAllMovies() public view returns (Movie[] memory) {
        Movie[] memory allMovies = new Movie[](_movieIds.current());
        for (uint256 i = 1; i <= _movieIds.current(); i++) {
            allMovies[i - 1] = movies[i];
        }
        return allMovies;
    }

    function parseActors(string memory actorsString) internal pure returns (address[] memory) {
        bytes memory actorsBytes = bytes(actorsString);
        uint256 count = 1;
        for (uint i = 0; i < actorsBytes.length; i++) {
            if (actorsBytes[i] == ',') {
                count++;
            }
        }
    
        address[] memory actors = new address[](count);
        uint256 actorIndex = 0;
        uint256 startIndex = 0;
    
        for (uint i = 0; i <= actorsBytes.length; i++) {
            if (i == actorsBytes.length || actorsBytes[i] == ',') {
                bytes memory addressBytes = new bytes(20);
                for (uint j = 0; j < 20 && (startIndex + j) < actorsBytes.length; j++) {
                    addressBytes[j] = actorsBytes[startIndex + j];
                }
                actors[actorIndex] = address(uint160(bytes20(addressBytes)));
                actorIndex++;
                startIndex = i + 1;
            }
        }
    
        return actors;
    }

    function _exists(uint256 tokenId) internal view returns (bool) {
        return _ownerOf(tokenId) != address(0);
    }

    // Function to withdraw accumulated fees
    function withdrawFees() public onlyOwner {
        uint256 balance = storyUSD.balanceOf(address(this));
        require(balance > 0, "No fees to withdraw");
        storyUSD.safeTransfer(owner(), balance);
    }

    // Function to distribute royalties
    function distributeRoyalties(uint256 movieId, uint256 amount) public {
        require(_exists(movieId), "Movie does not exist");
        Movie storage movie = movies[movieId];
        address[] memory actors = parseActors(movie.actors);
    
        uint256 platformAmount = (amount * PLATFORM_SHARE) / 100;
        uint256 actorAmount = amount - platformAmount;

        // Transfer platform share
        storyUSD.safeTransferFrom(msg.sender, owner(), platformAmount);
        emit RoyaltyPaid(movieId, owner(), platformAmount);

        // Transfer actor shares
        if (actors.length > 0) {
            uint256 individualActorAmount = actorAmount / actors.length;
            for (uint i = 0; i < actors.length; i++) {
                storyUSD.safeTransferFrom(msg.sender, actors[i], individualActorAmount);
                emit RoyaltyPaid(movieId, actors[i], individualActorAmount);
            }
        } else {
            // If no actors, all goes to the platform
            storyUSD.safeTransferFrom(msg.sender, owner(), actorAmount);
            emit RoyaltyPaid(movieId, owner(), actorAmount);
        }
    }
}