import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Keypair,
} from "@solana/web3.js";
import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { ZeroLiquid } from "../../target/types/zero_liquid";

const anycast: any = anchor;
const program = anycast.workspace.ZeroLiquid as Program<ZeroLiquid>;

export const getSaleAddress = (tokenAccountAddress: PublicKey) => {
  return PublicKey.findProgramAddress(
    [anchor.utils.bytes.utf8.encode("sale"), tokenAccountAddress.toBytes()],
    program.programId
  );
};
