use anchor_lang::prelude::*;
use anchor_lang::AccountsClose;
use anchor_spl::token;
mod anchor_transfer;
//this is how i should set it up for a refactor
declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");
const AUTHORITY_SEED: &[u8] = b"auth";
const SALE_SEED: &[u8] = b"sale";

#[program]
pub mod zero_liquid {
    use super::*;
    pub fn post_sale(
        ctx: Context<PostSale>,
        sale_bump: u8,
        _book_authority_bump: u8,
        token_price: u64,
    ) -> ProgramResult {
        ctx.accounts.sale.seller = ctx.accounts.seller.key();
        ctx.accounts.sale.token_account = ctx.accounts.seller_token_account.key();
        ctx.accounts.sale.token_mint = ctx.accounts.seller_token_account.mint.key();
        ctx.accounts.sale.token_price = token_price;
        ctx.accounts.sale.bump = sale_bump;
        Ok(())
    }
    pub fn take_sale(ctx: Context<TakeSale>, authority_bump: u8, num_tokens: u64) -> ProgramResult {
        let seeds = &[&AUTHORITY_SEED[..], &[authority_bump]];
        //transfer spl token from seller to buyer
        token::transfer(
            ctx.accounts
                .into_transfer_tokens_to_buyer_context()
                .with_signer(&[seeds]),
            num_tokens,
        )?;
        let lamports = ctx
            .accounts
            .sale
            .token_price
            .checked_mul(num_tokens)
            .unwrap();
        //transfer lamps from buyer to seller
        anchor_transfer::transfer_from_signer(
            ctx.accounts.into_transfer_lamports_to_seller_context(),
            lamports,
        )?;
        //close the sale account if there are no more tokens delegated
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
                .sale
                .close(ctx.accounts.seller.to_account_info())?;
        }
        Ok(())
    }

    pub fn close_sale(ctx: Context<CloseSale>) -> ProgramResult {
        //anyone can close if the delegated amount is zero
        //if seller wants to close, they undelegate then call this
        ctx.accounts
            .sale
            .close(ctx.accounts.closer.to_account_info())?;
        Ok(())
    }

    pub fn change_sale_price(ctx: Context<ChangeSalePrice>, new_price: u64) -> ProgramResult {
        ctx.accounts.sale.token_price = new_price;
        Ok(())
    }

    //post buy
    //take buy
}

#[derive(Accounts)]
#[instruction(sale_bump: u8, book_authority_bump: u8)]
pub struct PostSale<'info> {
    #[account(mut)]
    seller: Signer<'info>,
    #[account(
        constraint = seller_token_account.owner == seller.key(),
        constraint = seller_token_account.delegate.unwrap() == book_authority.key(),
        constraint = seller_token_account.delegated_amount > 0,
    )]
    seller_token_account: Account<'info, token::TokenAccount>,
    #[account(
        init,
        seeds = [SALE_SEED, seller_token_account.key().as_ref()],
        bump = sale_bump,
        payer = seller
    )]
    sale: Account<'info, Sale>,
    #[account(
        seeds = [AUTHORITY_SEED],
        bump = book_authority_bump
    )]
    book_authority: AccountInfo<'info>,
    system_program: Program<'info, System>,
}
/*
we only create sales where seller_token_account is the seed for sale pda
all sales enforced with token account owner as seller and token account mint as sale mint
this means if the token account matches in the seed, we know that the sale will have the token account's owner
as the seller and its mint as the sale mint
*/

#[derive(Accounts)]
pub struct TakeSale<'info> {
    #[account(mut)]
    buyer: Signer<'info>,
    #[account(
        mut,
        constraint = buyer_token_account.owner.key() == buyer.key(),
        constraint = buyer_token_account.mint == seller_token_account.mint
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
        seeds = [SALE_SEED, seller_token_account.key().as_ref()],
        bump = sale.bump,
    )]
    sale: Account<'info, Sale>,
    book_authority: AccountInfo<'info>,
    token_program: Program<'info, token::Token>,
    system_program: Program<'info, System>,
}

//this needs to be permissionless (or have a permless version) so token accounts without tokens can be closed
#[derive(Accounts)]
pub struct CloseSale<'info> {
    #[account(mut)]
    closer: AccountInfo<'info>,
    seller: AccountInfo<'info>,
    #[account(
        constraint = seller_token_account.owner == seller.key(),
        constraint = seller_token_account.delegated_amount == 0,
    )]
    seller_token_account: Account<'info, token::TokenAccount>,
    #[account(
        mut,
        seeds = [SALE_SEED, seller_token_account.key().as_ref()],
        bump = sale.bump,
    )]
    sale: Account<'info, Sale>,
}

#[derive(Accounts)]
pub struct ChangeSalePrice<'info> {
    seller: Signer<'info>,
    #[account(
        mut,
        constraint = sale.seller == seller.key()
    )]
    sale: Account<'info, Sale>,
}

#[account]
#[derive(Default)]
pub struct Sale {
    seller: Pubkey,
    token_account: Pubkey,
    token_mint: Pubkey,
    token_price: u64,
    bump: u8,
}
/*
need all these attrs to filter on the client
//could potentially use a subgraph for this i think??
and just post bare minimum
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

//so how do u find the token account from the sale / vice versa
//i guess u just have to use ATA or it won't work
//token price (per token) in lamports
//potentially this could get clogged if people are pushing token accounts that arent ATAs into the program
//eh i mean u could just pass them back in same way to close
//for example u could make a new token account owned by a seller, pass that into the program to close any account
//dealbreaker
//but if u have to own the token account to make a sale for it, then it doesn't really matter
//could also run it with pda's and have pda seed using tokenaccount key
//the problem is how do u allow for permissionless closing. i guess u could just not allow that?
//but if people sell or undelegate u need to be able to close

/*

ok this is fucked up bc it will be p much impossible to find any of the token accounts outside of ATAs
so my options are to enforce ATAs or to add the token account to it

nice thing about non ATAs is u could do concentrated liquidity and it's not that much more cost, and u can
so i think i need to add token account attr to this. not sure there's any other way
can still leave the pda attr bc there's not really a benefit to taking it away


alternatives:
- set the token account in the sale instead of the seller
- harder to find the accounts from the seller
- possibly could do both, not sure what the rent will be on that


storing token account means u could technically have multiple sales open for same wallet, but u still need dif token accounts

that's the other thing is if someone sells their tokens u need to be able to clear the accounts without their permission
kinda fucked on that front

*/
/*

all sales for a token
getProgramAccounts looking for tokenmint in sale account
sort by price

sale for a wallet
getProgramAccounts looking for seller in sale account

ok

*/

/*

what do u need to find
- hg


*/

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
//i could make it a pda based on the token account and run the sale that way?? get attribution without storing it. thanks toly
//ok we should be good. only thing i would change is that if the seller signs it, then they should get the money, otherwise the closer gets it
