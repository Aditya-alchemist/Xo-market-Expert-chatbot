Evaluating Market Mechanisms for XO.Market: Orderbooks, AMMs, and LS-LMSR

XO.Market Research & Product Team

March 2025

Abstract

This paper evaluates three market mechanisms for prediction markets in the context of XO.Market: traditional Orderbooks, Automated Market Makers (AMMs), and Liquidity-Sensitive Logarithmic Mar- ket Scoring Rule (LS-LMSR). We analyze their strengths and limitations across dimensions of liquidity, usability, scalability, and price discovery. After comparative assessment, we identify LS-LMSR as the optimal mechanism for XO.Market’s prediction protocol, due to its capital efficiency, belief-sensitivity, and scalability for user-generated markets. The paper includes mathematical formulations and imple- mentation considerations for LS-LMSR in the XO.Market context.

Introduction

The design of efficient and scalable prediction market protocols requires careful consideration of pricing mechanisms, trading interfaces, and liquidity provision [P[ennock and Wellman, 2001\]. This](#_page4_x47.09_y295.07) paper evaluates three primary approaches for XO.Market, a next-generation prediction market protocol: traditional Order- books, Automated Market Makers (AMMs), and the Liquidity-Sensitive Logarithmic Market Scoring Rule (LS-LMSR) [\[Othman et al., 2013\]. ](#_page4_x47.09_y263.19)We assess each mechanism’s strengths and limitations in the context of prediction markets, with a focus on scalability, usability, decentralization, and support for expressive, high-resolution markets.

1  Orderbooks
1. Overview

Orderbooks are a well-established mechanism used in centralized exchanges and some on-chain trading platforms. In this system, traders submit bids and asks, with trades occurring when buy and sell orders match. Prices are determined by supply and demand, and liquidity is provided directly by users or market makers.

2. Advantages
- Price discovery: Orderbooks facilitate fine-grained, user-driven price discovery.
- Familiarity: Many traders are accustomed to this mechanism.
- Efficiency in deep markets: High-volume markets can achieve tight spreads and low slippage.
3. Challenges for Prediction Markets
- Liquidity fragmentation: Low-liquidity markets suffer from wide spreads and poor usability.
- High UX friction: Users must place and manage orders, which can be unintuitive for casual or social users.
- Poor scalability: Each market requires dedicated market makers to be viable.
- Latency and front-running risks: On-chain orderbooks are often slow and vulnerable to Miner Extractable Value (MEV).
4. Summary

While powerful in traditional financial markets, orderbooks require active market-making and dense liquidity to be viable. For the long-tail, event-driven, or user-generated prediction markets that XO.Market aims to support, they create more friction than value.

2  Automated Market Makers (AMMs)
1. Overview

AMMs use a pricing formula to continuously quote prices and provide liquidity [\[Adams et al., 2020\]. Users ](#_page4_x47.09_y91.83)trade against a smart contract, and liquidity providers supply capital to pools, eliminating the need for a matching engine.

2. Advantages
- Always-on liquidity: Trades can occur even in thin markets.
- Simplicity: No need to manage or match orders.
- Composability: AMMs integrate well with DeFi and on-chain tooling.
3. Challenges in Prediction Context
- Capital inefficiency: Liquidity must be allocated upfront for each outcome.
- Fixed curve pricing: Standard AMMs like constant-product (e.g., Uniswap) do not reflect belief- based market dynamics well.
- No incentive for accurate pricing: AMMs passively offer prices without encouraging accurate prediction.
4. Prediction-Specific AMMs

Some protocols adapt AMMs for prediction markets (e.g., Omen’s fixed-supply AMM, Gnosis Protocol [Chen [et al.,](#_page4_x47.09_y123.71) [2020\]).](#_page4_x47.09_y123.71) These work reasonably for binary outcomes but struggle with multi-outcome or high-resolution events.

5. Summary

While AMMs offer usability and DeFi composability, they are not belief-sensitive, and capital inefficiency makes them suboptimal for large-scale, user-generated prediction markets with complex outcomes.

3  LS-LMSR (Liquidity-Sensitive Logarithmic Market Scoring Rule)
1. Overview

LS-LMSR is a dynamic market-making algorithm derived from Hanson’s original LMSR [\[Hanson, 2007\], ](#_page4_x47.09_y187.47)designed to provide liquidity-sensitive pricing in prediction markets [\[Othman et al., 2010\]. The](#_page4_x47.09_y219.35) cost of a trade depends on both the current market probabilities and the amount being traded.

2. How It Works
- Prices are derived from a scoring rule that ensures bounded loss [[Zhang et al., 2011\].](#_page4_x47.09_y326.95)
- As more capital enters the market, the “b” parameter (liquidity sensitivity) adjusts to reduce price impact [\[Othman et al., 2013\].](#_page4_x47.09_y263.19)
- Markets self-correct based on beliefs, not just supply/demand.
3. Advantages
- Always-available pricing: Users can buy/sell at any time.
- Belief sensitivity: Prices move proportionally to information, incentivizing accurate forecasting.
- Capital efficiency: No need for upfront liquidity pools; trades bootstrap market depth.
- Supports many outcomes: Handles binary and multi-outcome markets with ease [\[Hanson, 2003\].](#_page4_x47.09_y155.59)
4. Practical Benefits for XO.Market
- Viability for long-tail markets: LS-LMSR enables support for user-generated markets with minimal initial liquidity.
- Smooth user experience: No order management; users can directly express beliefs.
- Dynamic liquidity provisioning: Market depth grows with usage, not upfront capital.
5. Limitations
- Price manipulation risks in thin markets: Without external information, attackers could poten- tially distort prices, although this is mitigated by resolution mechanisms.
- Complexity: Slightly less intuitive than AMMs or orderbooks for DeFi-native users.
6. Summary

LS-LMSR aligns strongly with the goals of a belief-based prediction platform, offering always-available liquidity, belief-driven pricing, and scalability without requiring market makers or fixed liquidity pools.

4  Why XO.Market Chose LS-LMSR

XO.Market’s decision to implement LS-LMSR as its core market mechanism was driven by several key theoretical and practical considerations:

- Scalability and Capital Efficiency: LS-LMSR allows for the creation of markets without requiring substantial upfront liquidity. This property is crucial for supporting a large number of user-generated markets, including those addressing niche or long-tail events.
- Belief-Sensitive Price Discovery: The mechanism inherently incorporates traders’ beliefs into the price formation process. This aligns with the fundamental goal of prediction markets to aggregate information and produce accurate forecasts.
- Multi-Outcome Support: LS-LMSR naturally extends to markets with multiple outcomes, including those with high-resolution or continuous outcome spaces. This flexibility is essential for creating diverse and expressive prediction markets.
- Bounded Loss Property: The logarithmic scoring rule ensures that the maximum possible loss for the market maker is bounded and known in advance, providing important risk management capabilities.
- Incentive Compatibility: LS-LMSR incentivizes truthful reporting of beliefs, as traders maximize their expected utility by accurately expressing their probability estimates.
- Dynamic Liquidity Adjustment: The liquidity-sensitive aspect of LS-LMSR allows for automatic adjustment of market depth based on trading activity, enhancing efficiency as markets mature.
- Theoretical Grounding: LS-LMSR is built upon a solid foundation of academic research in market design, information aggregation, and scoring rules, providing a robust framework for further develop- ment and optimization.
- Parameterization Flexibility: The mechanism allows for fine-tuning of market behavior through adjustments to the liquidity parameter, enabling customization for different types of events or market objectives.

By selecting LS-LMSR, XO.Market aims to create a prediction market protocol that maximizes informa- tion aggregation efficiency, supports a wide range of market types, and scales effectively to accommodate a growing ecosystem of decentralized forecasting applications.

5  Conclusion

After extensive exploration, we conclude that LS-LMSR strikes the ideal balance between usability, accuracy, scalability, and decentralization for XO.Market. It enables us to serve crypto-native traders, casual bettors, and community-driven market creators within a unified framework.

While we may continue to explore hybrid mechanisms and allow plugins for different resolution and liquidity models in the future, LS-LMSR provides the most powerful and flexible foundation for our mission to unlock prediction markets at scale.

6  Mathematical Formulation of LS-LMSR

The core of the LS-LMSR mechanism is based on the following cost function [\[Othman et al., 2013\]:](#_page4_x47.09_y263.19)



C(q) = b * ln( Σ_{i=1..n} exp(q_i / b) ) (1)


Where:

- q is the vector of quantities of shares for each outcome
- b is the liquidity parameter
- n is the number of possible outcomes The price of outcome i is given by:

p_i = ∂C/∂q_i = exp(q_i / b) / ( Σ_{j=1..n} exp(q_j / b) ) (2)

The liquidity sensitivity is implemented by directly relating the liquidity parameter bto the total liquidity in the market:

b= a ·Q (3)

Where:

- a is a fixed liquidity scaling parameter
- Q represents the total liquidity available in the market

This linear relationship ensures that market depth scales proportionally with available liquidity, auto- matically adjusting price impact as the market grows. As more liquidity enters the market, the value of b increases, which reduces price slippage and allows for larger trades with less market impact.

References

<a name="_page4_x47.09_y91.83"></a>Hayden Adams, Noah Zinsmeister, Mauricio Salem, River Keefer, and Dan Robinson. Uniswap v2 core.

URL: https://uniswap.org/whitepaper.pdf, 2020.

<a name="_page4_x47.09_y123.71"></a>Alan Chen, Zvezdomir Lenka, Felix Li, and Loi Luu. Gnosis protocol: A decentralized trading protocol.

URL: https://gnosis.io/gnosisprotocol.pdf, 2020.

<a name="_page4_x47.09_y155.59"></a>Robin Hanson. Combinatorial information market design. Information Systems Frontiers, 5(1):107–119,

2003\.

<a name="_page4_x47.09_y187.47"></a>Robin Hanson. Logarithmic market scoring rules for modular combinatorial information aggregation. The

Journal of Prediction Markets, 1(1):3–15, 2007.

<a name="_page4_x47.09_y219.35"></a>Abraham Othman, David M Pennock, Daniel M Reeves, and Tuomas Sandholm. A practical liquidity-

sensitive automated market maker. In Proceedings of the 11th ACM conference on Electronic commerce, pages 377–386, 2010.

<a name="_page4_x47.09_y263.19"></a>Abraham Othman, David M Pennock, Daniel M Reeves, and Tuomas Sandholm. Practical liquidity-sensitive

automated market makers. ACM Transactions on Economics and Computation, 1(3):1–25, 2013.

<a name="_page4_x47.09_y295.07"></a>David M Pennock and Michael P Wellman. Computational aspects of information markets. ACM SIGecom

Exchanges, 2(1):1–5, 2001.

<a name="_page4_x47.09_y326.95"></a>Haoqi Zhang, David M Pennock, and C Lee Giles. Bounded-loss pricing for contingent claims. In Proceedings

of the 12th ACM conference on Electronic commerce, pages 19–28, 2011.
5
