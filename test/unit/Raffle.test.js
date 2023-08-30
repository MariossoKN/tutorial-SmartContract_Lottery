const { deployments, ethers, getNamedAccounts, network } = require("hardhat")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")
const { assert, expect } = require("chai")

// running unit tests only on development chain
!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Raffle", async function () {
          let raffle, deployer, vrfCoordinatorV2Mock, raffleEntranceFee, interval
          const chainId = network.config.chainId
          const randomWords = [202]

          beforeEach(async function () {
              deployer = (await getNamedAccounts()).deployer
              await deployments.fixture(["all"]) // it will run all "all" tag scripts
              raffle = await ethers.getContract("Raffle", deployer)
              vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer)
              raffleEntranceFee = await raffle.getEntranceFee()
              interval = await raffle.getInterval()
          })

          describe("Constructor", function () {
              it("Initializes the raffle correctly", async function () {
                  // idealy we make our test have just 1 assert per it
                  const raffleState = await raffle.getRaffleState() // enums get back as numbers: 0, 1, ...
                  console.log(raffleState)
                  assert.equal(raffleState.toString(), "0")
                  assert.equal(interval.toString(), networkConfig[chainId]["interval"])
              })
          })

          describe("enterRaffle", function () {
              it("Contract reverts when the entrance fee is low", async function () {
                  await expect(raffle.enterRaffle()).to.be.revertedWith(
                      "Raffle__SendMoreToEnterRaffle"
                  )
              })

              it("Records players when they enter", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  const player = await raffle.getPlayer(0)
                  assert.equal(player, deployer)
              })
              it("Emits event on enter", async function () {
                  await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.emit(
                      raffle,
                      "RaffleEnter"
                  )
              })
              it("Contract reverts if the raffle is not open", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  // manipulating the blockchain
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  // pretending to be a chainlink keeper
                  await raffle.performUpkeep([])
                  await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.be.revertedWith(
                      "Raffle__RaffleNotOpen"
                  )
              })
          })
          describe("checkUpkeep", function () {
              it("Returns false if people havent sent any ETH", async function () {
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([]) // callStatic simulates calling a transaction
                  // const { upkeepNeeded } = this extrapolates just the upkeepNeeded paramater
                  assert(!upkeepNeeded)
              })
              it("Returns false if raffle isnt open", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  await raffle.performUpkeep([])
                  const raffleState = await raffle.getRaffleState()
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([])
                  assert.equal(raffleState.toString(), "1")
                  assert.equal(upkeepNeeded, false)
              })
              it("Returns false if not enough time passed", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() - 5])
                  await network.provider.send("evm_mine", [])
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([])
                  assert.equal(upkeepNeeded, false)
              })
              it("Returns true if enough time paseed, has players/balance and is open", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([])
                  assert.equal(upkeepNeeded, true)
              })
          })
          describe("performUpkeep", function () {
              it("Only can run when checkUpkeep is true", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  const tx = await raffle.performUpkeep([]) // if this fails, assert(tx) will fail
                  assert(tx)
              })

              it("Reverts if upkeep is not needed", async function () {
                  await expect(raffle.performUpkeep([])).to.be.revertedWith(
                      "Raffle__UpkeepNotNeeded"
                  )
              })
              //   it("After performing upkeep, the state has to change to CALCULATING", async function () {
              //       await raffle.enterRaffle({ value: raffleEntranceFee })
              //       await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
              //       await network.provider.send("evm_mine", [])
              //       await raffle.performUpkeep([])
              //       const raffleState = await raffle.getRaffleState()
              //       assert.equal(raffleState.toString(), "1")
              //   })
              //   it("Emits event on upkeep", async function () {
              //       await raffle.enterRaffle({ value: raffleEntranceFee })
              //       await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
              //       await network.provider.send("evm_mine", [])
              //       await expect(raffle.performUpkeep([])).to.emit(raffle, "RequestedRaffleWinner")
              //   })
              it("Updates the raffle state, emits and event and calls the vrf coordinator", async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  const txResponse = await raffle.performUpkeep([])
                  const txReceipt = await txResponse.wait(1)
                  const requestId = txReceipt.events[1].args.requestId
                  const raffleState = await raffle.getRaffleState()
                  assert(requestId.toNumber() > 0)
                  assert(raffleState.toString() == 1)
              })
          })
          describe("fulfillRandomWords", function () {
              beforeEach(async function () {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
              })
              it("Can only be called after performUpkeep", async function () {
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(0, raffle.address)
                  ).to.be.revertedWith("nonexistent request")
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(1, raffle.address)
                  ).to.be.revertedWith("nonexistent request")
              })
              it("Picks a winner, resets the lottery and sends the eth", async function () {
                  const additionalEntrants = 3
                  const startingAccountIndex = 1 // 0 = deployer
                  const accounts = await ethers.getSigners()
                  for (
                      let i = startingAccountIndex;
                      i < startingAccountIndex + additionalEntrants;
                      i++
                  ) {
                      const accountConnectedRaffle = raffle.connect(accounts[i])
                      await accountConnectedRaffle.enterRaffle({ value: raffleEntranceFee })
                  }
                  const startingTimeStamp = await raffle.getLastTimeStamp()
                  await new Promise(async (resolve, reject) => {
                      raffle.once("WinnerPicked", async () => {
                          // once the WinnerPicked event is fired, do something..
                          console.log("Found the event.")
                          try {
                              const recentWinner = await raffle.getRecentWinner()
                              //   console.log(recentWinner)
                              //   console.log("------------")
                              //   console.log(accounts[0].address)
                              //   console.log(accounts[1].address)
                              //   console.log(accounts[2].address)
                              //   console.log(accounts[3].address)
                              const raffleState = await raffle.getRaffleState()
                              const endintTimeStamp = await raffle.getLastTimeStamp()
                              const numPlayers = await raffle.getNumberOfPlayers()
                              const winnerEndingBalance = await accounts[1].getBalance()
                              assert.equal(numPlayers.toString(), "0")
                              assert.equal(raffleState.toString(), "0")
                              assert(endintTimeStamp > startingTimeStamp)
                              assert.equal(
                                  winnerEndingBalance.toString(),
                                  winnerStartingBalance.add(
                                      raffleEntranceFee
                                          .mul(additionalEntrants)
                                          .add(raffleEntranceFee)
                                          .toString()
                                  )
                              )
                          } catch (e) {
                              reject(e)
                          }
                          resolve()
                      })
                      const tx = await raffle.performUpkeep([])
                      const txReceipt = await tx.wait(1)
                      const winnerStartingBalance = await accounts[1].getBalance()
                      await vrfCoordinatorV2Mock.fulfillRandomWords(
                          txReceipt.events[1].args.requestId,
                          raffle.address
                      )
                  })
              })
          })
          //   describe("fulfillRandomWords", async function () {
          //       it("Calculates a random winner", async function () {
          //           await raffle.enterRaffle({ value: raffleEntranceFee })
          //           await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
          //           await network.provider.send("evm_mine", [])
          //           await raffle.performUpkeep([])
          //           await raffle.fulfillRandomWords([], randomWords)
          //           const recentWinner = await raffle.getRecentWinner()
          //           assert.equal(recentWinner.toString(), "2")
          //       })
          //   })
      })
