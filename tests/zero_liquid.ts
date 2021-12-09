import * as anchor from "@project-serum/anchor";
import * as web3 from "@solana/web3.js";
import { Keypair, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, Token, MintLayout } from "@solana/spl-token";

import { BN, Program } from "@project-serum/anchor";
import { ZeroLiquid } from "../target/types/zero_liquid";
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAccountAddress,
} from "./helpers/tokenHelpers";

describe("zero_liquid", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.Provider.env();
  anchor.setProvider(provider);
  const anycast: any = anchor;
  const program = anycast.workspace.ZeroLiquid as Program<ZeroLiquid>;

  let mint = Keypair.generate();
  let mintAuthority = Keypair.generate();
  let payer = provider.wallet.publicKey;
  let userTokenAccount = null;
  let bookAuthority = null;
  let bookAuthorityBump = null;
  let buyer = Keypair.generate();
  let buyerTokenAccount = null;
  let seller = Keypair.generate();
  let sellerTokenAccount = null;
  let sellOrder = web3.Keypair.generate();
  let NewToken = null;
  it("config", async () => {
    userTokenAccount = await getAssociatedTokenAccountAddress(
      payer,
      mint.publicKey
    );
    buyerTokenAccount = await getAssociatedTokenAccountAddress(
      buyer.publicKey,
      mint.publicKey
    );
    sellerTokenAccount = await getAssociatedTokenAccountAddress(
      seller.publicKey,
      mint.publicKey
    );
    let [_authority, _authorityBump] = await web3.PublicKey.findProgramAddress(
      [anchor.utils.bytes.utf8.encode("auth")],
      program.programId
    );
    bookAuthority = _authority;
    bookAuthorityBump = _authorityBump;

    // await web3.sendAndConfirmTransaction(
    //   provider.connection,
    //   new web3.Transaction().add(approve),
    //   [seller]
    // );

    const tx = await program.rpc.initialize({
      accounts: {},
      instructions: [
        web3.SystemProgram.createAccount({
          fromPubkey: payer,
          newAccountPubkey: mint.publicKey,
          space: MintLayout.span,
          lamports: await provider.connection.getMinimumBalanceForRentExemption(
            MintLayout.span
          ),
          programId: TOKEN_PROGRAM_ID,
        }),
        //init the mint
        Token.createInitMintInstruction(
          TOKEN_PROGRAM_ID,
          mint.publicKey,
          0,
          mintAuthority.publicKey,
          mintAuthority.publicKey
        ),
        createAssociatedTokenAccountInstruction(
          mint.publicKey,
          buyerTokenAccount,
          buyer.publicKey,
          payer
        ),
        createAssociatedTokenAccountInstruction(
          mint.publicKey,
          sellerTokenAccount,
          seller.publicKey,
          payer
        ),
      ],
      signers: [mint],
    });
    console.log("tx sig", tx);

    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        buyer.publicKey,
        5 * web3.LAMPORTS_PER_SOL
      ),
      "confirmed"
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        seller.publicKey,
        5 * web3.LAMPORTS_PER_SOL
      ),
      "confirmed"
    );

    NewToken = new Token(
      provider.connection,
      mint.publicKey,
      TOKEN_PROGRAM_ID,
      buyer
    );
    await NewToken.mintTo(sellerTokenAccount, mintAuthority, [], 100);

    await printTokenBalance(buyerTokenAccount, provider.connection, "buyer");
    await printTokenBalance(sellerTokenAccount, provider.connection, "seller");
  });

  it("post sale", async () => {
    let tokenPrice = new BN(20);
    const tx = await program.rpc.postSale(bookAuthorityBump, tokenPrice, {
      accounts: {
        seller: seller.publicKey,
        sellerTokenAccount: sellerTokenAccount,
        sellOrder: sellOrder.publicKey,
        bookAuthority: bookAuthority,
      },
      instructions: [
        await program.account.sellOrder.createInstruction(sellOrder),
        Token.createApproveInstruction(
          TOKEN_PROGRAM_ID,
          sellerTokenAccount,
          bookAuthority,
          seller.publicKey,
          [],
          70
        ),
      ],
      signers: [seller, sellOrder],
    });
    let newSellOrder = await program.account.sellOrder.fetch(
      sellOrder.publicKey
    );
    console.log(newSellOrder);
  });

  it("take sale", async () => {
    await printLampsBalance(buyer.publicKey, provider.connection, "buyer");
    let b4sellerTokenInfo = await NewToken.getAccountInfo(sellerTokenAccount);
    console.log(b4sellerTokenInfo.delegatedAmount.toNumber());
    let numTokens = new BN(70);
    const tx = await program.rpc.takeSale(bookAuthorityBump, numTokens, {
      accounts: {
        buyer: buyer.publicKey,
        buyerTokenAccount: buyerTokenAccount,
        seller: seller.publicKey,
        sellerTokenAccount: sellerTokenAccount,
        sellOrder: sellOrder.publicKey,
        bookAuthority: bookAuthority,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
      },
      signers: [buyer],
    });
    await printTokenBalance(buyerTokenAccount, provider.connection, "buyer");
    await printTokenBalance(sellerTokenAccount, provider.connection, "seller");

    await printLampsBalance(buyer.publicKey, provider.connection, "buyer");

    let sellerTokenInfo = await NewToken.getAccountInfo(sellerTokenAccount);
    console.log(sellerTokenInfo.delegatedAmount.toNumber());
  });

  //throws error when the account gets properly closed
  // it("check if close", async () => {
  //   let order = await program.account.sellOrder.fetch(sellOrder.publicKey);
  //   console.log(order);
  // });
});

const printTokenBalance = async (
  tokenAccount: web3.PublicKey,
  connection: web3.Connection,
  name: string
) => {
  let balance = await connection.getTokenAccountBalance(tokenAccount);
  console.log(name + " balance: " + balance.value.uiAmount);
};
const printLampsBalance = async (
  address: web3.PublicKey,
  connection: web3.Connection,
  name: string
) => {
  let balance = await connection.getBalance(address);
  console.log(name + " lamps: " + balance);
};
/*

let me get a token and delegate authority to a program account

figure out how to take custody of funds
this is only spl tokens and sol base



*/
