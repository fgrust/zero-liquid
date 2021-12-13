import * as anchor from "@project-serum/anchor";
import * as web3 from "@solana/web3.js";
import {
  Keypair,
  SystemProgram,
  PublicKey,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, Token, MintLayout } from "@solana/spl-token";

import { BN, Program } from "@project-serum/anchor";
import { ZeroLiquid } from "../target/types/zero_liquid";
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAccountAddress,
} from "./helpers/tokenHelpers";
import { getSaleAddress } from "./helpers/addresses";
import { assert } from "chai";
import * as BufferLayout from "@solana/buffer-layout";
let BOOK_AUTHORITY_PK: PublicKey = web3.SystemProgram.programId;

describe("zero_liquid", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.Provider.env();
  anchor.setProvider(provider);
  const anycast: any = anchor;
  const program = anycast.workspace.ZeroLiquid as Program<ZeroLiquid>;

  let mint = Keypair.generate();
  let mintAuthority = Keypair.generate();
  let payer = Keypair.generate();
  let bookAuthority = null;
  let bookAuthorityBump = null;
  let buyer = Keypair.generate();
  let buyerTokenAccount = null;
  let seller = Keypair.generate();
  let sellerTokenAccount = null;
  let sale = null;
  let saleBump = null;
  let NewToken = null;
  it("config", async () => {
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
    BOOK_AUTHORITY_PK = _authority;
    let [_sale, _saleBump] = await getSaleAddress(sellerTokenAccount);
    sale = _sale;
    saleBump = _saleBump;

    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        payer.publicKey,
        5 * web3.LAMPORTS_PER_SOL
      ),
      "confirmed"
    );

    let configTransaction = new web3.Transaction().add(
      web3.SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mint.publicKey,
        space: MintLayout.span,
        lamports: await provider.connection.getMinimumBalanceForRentExemption(
          MintLayout.span
        ),
        programId: TOKEN_PROGRAM_ID,
      }),
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
        payer.publicKey
      ),
      createAssociatedTokenAccountInstruction(
        mint.publicKey,
        sellerTokenAccount,
        seller.publicKey,
        payer.publicKey
      )
    );
    await web3.sendAndConfirmTransaction(
      provider.connection,
      configTransaction,
      [payer, mint]
    );

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
    const tx = await program.rpc.postSale(
      saleBump,
      bookAuthorityBump,
      tokenPrice,
      {
        accounts: {
          seller: seller.publicKey,
          sellerTokenAccount: sellerTokenAccount,
          sale: sale,
          bookAuthority: bookAuthority,
          systemProgram: SystemProgram.programId,
        },
        instructions: [
          Token.createApproveInstruction(
            TOKEN_PROGRAM_ID,
            sellerTokenAccount,
            bookAuthority,
            seller.publicKey,
            [],
            70
          ),
        ],
        signers: [seller],
      }
    );
    let newSellOrder = await program.account.sale.fetch(sale);
    console.log("token price: ", newSellOrder.tokenPrice.toNumber());
  });

  it("take sale", async () => {
    await printLampsBalance(buyer.publicKey, provider.connection, "buyer");
    let num = 68;
    let numTokens = new BN(num);
    const tx = await program.rpc.takeSale(bookAuthorityBump, numTokens, {
      accounts: {
        buyer: buyer.publicKey,
        buyerTokenAccount: buyerTokenAccount,
        seller: seller.publicKey,
        sellerTokenAccount: sellerTokenAccount,
        sale: sale,
        bookAuthority: bookAuthority,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
      },
      signers: [buyer],
    });
    await printTokenBalance(buyerTokenAccount, provider.connection, "buyer");
    await printTokenBalance(sellerTokenAccount, provider.connection, "seller");
    let buyerBalance = await provider.connection.getTokenAccountBalance(
      buyerTokenAccount
    );

    assert(buyerBalance.value.uiAmount === num);

    await printLampsBalance(
      buyer.publicKey,
      provider.connection,
      "buyer after purchase"
    );

    // let sellerTokenInfo = await NewToken.getAccountInfo(sellerTokenAccount);
    // console.log(sellerTokenInfo.delegatedAmount.toNumber());
  });

  it("change sale price", async () => {
    let newPrice = 18;
    let newPriceBN = new BN(newPrice);
    const tx = await program.rpc.changeSalePrice(newPriceBN, {
      accounts: {
        seller: seller.publicKey,
        sale: sale,
      },
      signers: [seller],
    });
    let newSellOrder = await program.account.sale.fetch(sale);
    assert(newSellOrder.tokenPrice.eq(newPriceBN));
    console.log("new price: ", newSellOrder.tokenPrice.toNumber());
  });

  // it("remove delegation and close sale", async () => {
  //   const tx = await program.rpc.closeSale({
  //     accounts: {
  //       closer: seller.publicKey,
  //       seller: seller.publicKey,
  //       sellerTokenAccount: sellerTokenAccount,
  //       sale: sale,
  //     },
  //     instructions: [
  //       Token.createRevokeInstruction(
  //         TOKEN_PROGRAM_ID,
  //         sellerTokenAccount,
  //         seller.publicKey,
  //         []
  //       ),
  //     ],
  //     signers: [seller],
  //   });
  // });

  it("fetch sales for token", async () => {
    let fetchingMint = mint.publicKey;
    let sales = await fetchSalesForMint(fetchingMint, provider.connection);
    printSales(sales);
  });

  it("fetch sales for wallet", async () => {
    let wallet = seller.publicKey;
    let sales = await fetchSalesForWallet(wallet, provider.connection);
    printSales(sales);
  });
  // it("close sale plain", async () => {
  //   const tx = await program.rpc.closeSale({
  //     accounts: {
  //       closer: buyer.publicKey,
  //       seller: seller.publicKey,
  //       sellerTokenAccount: sellerTokenAccount,
  //       sale: sale,
  //     },
  //   });
  // });

  //throws error when the account gets properly closed
  // it("check if close", async () => {
  //   let order = await program.account.sale.fetch(sale);
  //   console.log(order);
  //
  // });
});

export const ZERO_LIQUID_PROGRAM_ID = new web3.PublicKey(
  "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"
);
export const fetchSaleAccountsForMint = async (
  mint: web3.PublicKey,
  connection: web3.Connection
) => {
  let config = {
    filters: [
      {
        dataSize: 113,
      },
      {
        memcmp: {
          bytes: mint.toBase58(),
          offset: 72,
        },
      },
    ],
  };
  return connection
    .getProgramAccounts(ZERO_LIQUID_PROGRAM_ID, config)
    .then((responses) => {
      return responses;
    });
};
export const fetchSaleAccountsForWallet = async (
  wallet: web3.PublicKey,
  connection: web3.Connection
) => {
  let config = {
    filters: [
      {
        dataSize: 113,
      },
      {
        memcmp: {
          bytes: wallet.toBase58(),
          offset: 8,
        },
      },
    ],
  };
  return connection
    .getProgramAccounts(ZERO_LIQUID_PROGRAM_ID, config)
    .then((responses) => {
      return responses;
    });
};
export const decodeSaleAccount = (
  data: Buffer,
  publicKey: PublicKey
): RawSale => {
  let sale = SaleLayout.decode(data);
  return {
    publicKey: publicKey,
    seller: new PublicKey(sale.seller),
    tokenAccount: new PublicKey(sale.tokenAccount),
    tokenMint: new PublicKey(sale.tokenMint),
    tokenPrice: new BN(sale.tokenPrice),
  };
};
export interface RawSale {
  publicKey: PublicKey;
  seller: PublicKey;
  tokenAccount: PublicKey;
  tokenMint: PublicKey;
  tokenPrice: BN;
}
export interface Sale {
  publicKey: PublicKey;
  seller: PublicKey;
  tokenAccount: PublicKey;
  tokenMint: PublicKey;
  tokenPrice: BN;
  amount: BN;
}
export interface Sales {
  active: Sale[];
  zero: Sale[];
}

export const fetchSalesForMint = async (
  mint: PublicKey,
  connection: web3.Connection
): Promise<Sales> => {
  return fetchSaleAccountsForMint(mint, connection).then(async (responses) => {
    return toSales(responses, connection);
  });
};

export const fetchSalesForWallet = async (
  wallet: PublicKey,
  connection: web3.Connection
): Promise<Sales> => {
  return fetchSaleAccountsForWallet(wallet, connection).then(
    async (responses) => {
      return toSales(responses, connection);
    }
  );
};
interface Response {
  pubkey: anchor.web3.PublicKey;
  account: anchor.web3.AccountInfo<Buffer>;
}
export const toSales = async (
  saleResponses: Response[],
  connection: web3.Connection
): Promise<Sales> => {
  let burner = web3.Keypair.generate();
  let rawSales: RawSale[] = [];
  let tokenAccountPromises = saleResponses.map((response) => {
    //for every single one, fetch token account and see if mint is good
    let sale = decodeSaleAccount(response.account.data, response.pubkey);
    rawSales.push(sale);
    let ThisToken = new Token(
      connection,
      sale.tokenMint,
      TOKEN_PROGRAM_ID,
      burner
    );
    return ThisToken.getAccountInfo(sale.tokenAccount);
  });
  const tokenAccounts = await Promise.all(tokenAccountPromises);
  const zero = new BN(0);
  let activeSales: Sale[] = [];
  let zeroSales: Sale[] = [];
  tokenAccounts.forEach((tokenAccount, index) => {
    if (
      tokenAccount.delegate.equals(BOOK_AUTHORITY_PK) &&
      tokenAccount.delegatedAmount > zero
    ) {
      activeSales.push(toSale(rawSales[index], tokenAccount.delegatedAmount));
    } else {
      zeroSales.push(toSale(rawSales[index], tokenAccount.delegatedAmount));
    }
  });
  return { active: activeSales, zero: zeroSales };
};
const toSale = (rawSale: RawSale, amount: BN) => {
  return {
    publicKey: rawSale.publicKey,
    seller: rawSale.seller,
    tokenAccount: rawSale.tokenAccount,
    tokenMint: rawSale.tokenMint,
    tokenPrice: rawSale.tokenPrice,
    amount: amount,
  };
};

export const printSale = (sale: Sale) => {
  console.log(toReadable(sale));
};
const toReadable = (sale: Sale) => {
  return {
    publicKey: sale.publicKey.toBase58(),
    seller: sale.seller.toBase58(),
    tokenAccount: sale.seller.toBase58(),
    tokenMint: sale.tokenMint.toBase58(),
    tokenPrice: sale.tokenPrice.toString(),
    amount: sale.amount.toString(),
  };
};
const printSales = (sales: Sales) => {
  console.log("active: ");
  sales.active.forEach((sale) => {
    console.log(toReadable(sale));
  });
  console.log("zero: ");
  sales.zero.forEach((sale) => {
    console.log(toReadable(sale));
  });
};
const publicKey = (property: string) => {
  return BufferLayout.blob(32, property);
};
export const SaleLayout = BufferLayout.struct([
  BufferLayout.seq(BufferLayout.u8(), 8, "discriminator"),
  publicKey("seller"),
  publicKey("tokenAccount"),
  publicKey("tokenMint"),
  BufferLayout.nu64("tokenPrice"),
  BufferLayout.u8("bump"),
]);
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

//probably don't need
export const fetchRawSalesForWallet = async (
  wallet: PublicKey,
  connection: web3.Connection
) => {
  return fetchSaleAccountsForWallet(wallet, connection).then((responses) => {
    return responses.map((response) => {
      return decodeSaleAccount(response.account.data, response.pubkey);
    });
  });
};
export const fetchRawSalesForMint = async (
  mint: PublicKey,
  connection: web3.Connection
) => {
  return fetchSaleAccountsForMint(mint, connection).then((responses) => {
    return responses.map((response) => {
      return decodeSaleAccount(response.account.data, response.pubkey);
    });
  });
};
/*
write out my fetches


- get all sales for wallet
- get all sales for token 
  - (filter for active delegation)
  - sort by price 

*/

/*

this is only spl tokens and sol base
can easily add buy orders 


*/
//with size 112, it costs 32 cents to make a new account (29 cents without token account key)
//worth noting that u will be able to get the sol back when u close the sale account

// let saleSize = program.account.sale.size;
// console.log(saleSize);
// let rent = await provider.connection.getMinimumBalanceForRentExemption(
//   saleSize
// );
// console.log(rent / web3.LAMPORTS_PER_SOL);
