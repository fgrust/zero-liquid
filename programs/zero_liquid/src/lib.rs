use anchor_lang::prelude::*;
use anchor_lang::solana_program;
use anchor_lang::AccountsClose;
use anchor_spl::token;
mod anchor_transfer;
declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");
const AUTHORITY_SEED: &[u8] = b"auth";

#[program]
pub mod zero_liquid {
    use super::*;
    pub fn initialize(ctx: Context<Initialize>) -> ProgramResult {
        Ok(())
    }
    pub fn post_sale(
        ctx: Context<PostSale>,
        _book_authority_bump: u8,
        token_price: u64,
    ) -> ProgramResult {
        ctx.accounts.sell_order.seller = ctx.accounts.seller.key();
        ctx.accounts.sell_order.token_mint = ctx.accounts.seller_token_account.mint.key();
        ctx.accounts.sell_order.token_price = token_price;

        Ok(())
    }
    pub fn take_sale(ctx: Context<TakeSale>, authority_bump: u8, num_tokens: u64) -> ProgramResult {
        let seeds = &[&AUTHORITY_SEED[..], &[authority_bump]];
        token::transfer(
            ctx.accounts
                .into_transfer_tokens_to_buyer_context()
                .with_signer(&[seeds]),
            num_tokens,
        )?;

        let lamports = ctx
            .accounts
            .sell_order
            .token_price
            .checked_mul(num_tokens)
            .unwrap();

        //transfer amount to seller
        anchor_transfer::transfer_from_signer(
            ctx.accounts.into_transfer_lamports_to_seller_context(),
            lamports,
        )?;

        if ctx
            .accounts
            .seller_token_account
            .delegated_amount
            .checked_sub(num_tokens)
            .unwrap()
            == 0
        {
            msg!("close open order");
            ctx.accounts
                .sell_order
                .close(ctx.accounts.seller.to_account_info())?;
        }

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}

#[derive(Accounts)]
#[instruction(book_authority_bump: u8)]
pub struct PostSale<'info> {
    seller: Signer<'info>,
    #[account(
        constraint = seller_token_account.owner == seller.key(),
        constraint = seller_token_account.delegate.unwrap() == book_authority.key(),
        constraint = seller_token_account.delegated_amount > 0,
    )]
    seller_token_account: Account<'info, token::TokenAccount>,
    #[account(zero)]
    sell_order: Account<'info, SellOrder>,
    #[account(
        seeds = [AUTHORITY_SEED],
        bump = book_authority_bump
    )]
    book_authority: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct TakeSale<'info> {
    #[account(mut)]
    buyer: Signer<'info>,
    #[account(
        mut,
        constraint = buyer_token_account.owner.key() == buyer.key()
    )]
    buyer_token_account: Account<'info, token::TokenAccount>,
    #[account(mut)]
    seller: AccountInfo<'info>,
    #[account(
        mut,
        constraint = seller_token_account.owner.key() == seller.key()
    )]
    seller_token_account: Account<'info, token::TokenAccount>,
    #[account(
        mut,
        constraint = sell_order.token_mint == seller_token_account.mint,
        constraint = sell_order.seller.key() == seller_token_account.owner.key()
    )]
    sell_order: Account<'info, SellOrder>,
    book_authority: AccountInfo<'info>,
    token_program: Program<'info, token::Token>,
    system_program: Program<'info, System>,
}

#[account]
#[derive(Default)]
pub struct SellOrder {
    token_mint: Pubkey,
    seller: Pubkey,
    token_price: u64,
}
//token price in lamports

/*
u are probably gonna want to do attribution so u can find a wallet's offers easily in order to add to them vs having a wallet with lots of different open orders?

ATA location seeds
could add this later, right now just make it random
  [
            walletAddress.toBuffer(),
            TOKEN_PROGRAM_ID.toBuffer(),
            tokenMintAddress.toBuffer(),
        ],
*/

impl<'info> TakeSale<'info> {
    pub fn into_transfer_tokens_to_buyer_context(
        &self,
    ) -> CpiContext<'_, '_, '_, 'info, token::Transfer<'info>> {
        let cpi_program = self.token_program.to_account_info();
        let cpi_accounts = token::Transfer {
            from: self.seller_token_account.to_account_info(),
            to: self.buyer_token_account.to_account_info(),
            authority: self.book_authority.to_account_info(),
        };
        CpiContext::new(cpi_program, cpi_accounts)
    }
    pub fn into_transfer_lamports_to_seller_context(
        &self,
    ) -> CpiContext<'_, '_, '_, 'info, anchor_transfer::TransferLamports<'info>> {
        let cpi_program = self.system_program.to_account_info();
        let cpi_accounts = anchor_transfer::TransferLamports {
            from: self.buyer.to_account_info(),
            to: self.seller.to_account_info(),
            system_program: self.system_program.clone(),
        };
        CpiContext::new(cpi_program, cpi_accounts)
    }
}
