-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1
-- Tempo de geração: 25/11/2026 às 23:46
-- Versão do servidor: 10.4.32-MariaDB
-- Versão do PHP: 8.0.30

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Banco de dados: `trafego`
--

-- --------------------------------------------------------

--
-- Estrutura para tabela `cruzamentos`
--

CREATE TABLE `cruzamentos` (
  `id` int(11) NOT NULL,
  `nome` varchar(120) NOT NULL,
  `tipo_intersecao` varchar(20) NOT NULL,
  `tempo_verde` int(11) NOT NULL,
  `tempo_vermelho` int(11) NOT NULL,
  `onda_verde` tinyint(1) NOT NULL,
  `tempo_espera_medio` float NOT NULL,
  `congestionamento` varchar(10) NOT NULL,
  `veiculos_minuto` int(11) NOT NULL,
  `usuario_id` int(11) DEFAULT NULL,
  `criado_em` datetime(6) NOT NULL,
  `atualizado_em` datetime(6) NOT NULL
) ;

--
-- Despejando dados para a tabela `cruzamentos`
--

INSERT INTO `cruzamentos` (`id`, `nome`, `tipo_intersecao`, `tempo_verde`, `tempo_vermelho`, `onda_verde`, `tempo_espera_medio`, `congestionamento`, `veiculos_minuto`, `usuario_id`, `criado_em`, `atualizado_em`) VALUES
(1, 'Cruzamento Principal', 'Semaforo', 30, 30, 0, 45, 'MEDIO', 18, 2, '2026-11-25 21:39:03.099086', '2026-11-25 21:39:03.099089'),
(2, 'Avenida Central', 'Rotatoria', 25, 25, 0, 30, 'BAIXO', 12, 2, '2026-11-25 21:39:03.099887', '2026-11-25 21:39:03.099889');

-- --------------------------------------------------------

--
-- Estrutura para tabela `publicacoes`
--

CREATE TABLE `publicacoes` (
  `id` int(11) NOT NULL,
  `titulo` varchar(120) NOT NULL,
  `texto` text NOT NULL,
  `criada_em` datetime(6) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Estrutura para tabela `usuarios`
--

CREATE TABLE `usuarios` (
  `id` int(11) NOT NULL,
  `nome` varchar(120) NOT NULL,
  `email` varchar(254) NOT NULL,
  `cargo` varchar(20) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `ativo` tinyint(1) NOT NULL,
  `criado_em` datetime(6) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Despejando dados para a tabela `usuarios`
--

INSERT INTO `usuarios` (`id`, `nome`, `email`, `cargo`, `password_hash`, `ativo`, `criado_em`) VALUES
(1, 'isak', 'isak@gmail.com', 'Operador', 'scrypt:32768:8:1$J6jzNdoI1wfxAdT4$436d603a253ce3cfc2f4d04e7906dbf00f9d051426fb5cf81fb4ad9dc8482a31558eb6dadbb8a3ce6ff1e6a0bd94d01a141bafa2e6b233c7c015e51f0da0d193', 1, '2026-11-25 21:31:27.652932'),
(2, 'Administrador', 'admserra@gmail.com', 'Administrador', 'scrypt:32768:8:1$tSHxgD98D6F3Bgti$1c4cb8a0fa8d280ca1217dd1440f522b06d728a2398e962495a8a9014ca31de2f75a3b678035cdcf38036c96f9be8f1300ad6dbe6a823a84fcf32becc471ab1b', 1, '2026-11-25 21:39:03.095531'),
(5, 'Lucas Guilherme Moura', 'lucasguilhermemouratodacruz11@gmail.com', 'Administrador', 'scrypt:32768:8:1$e71cfRPazBvq5Hu2$2b1f783086d61f121c850c4cb85ca898573130a31ebf94b689801d931ac92f9c4a087b0c2cebcb9d040e00536665266a094d001e25b5defc70cdbb979d470848', 1, '2026-11-25 21:54:01.087054');

--
-- Índices para tabelas despejadas
--

--
-- Índices de tabela `cruzamentos`
--
ALTER TABLE `cruzamentos`
  ADD PRIMARY KEY (`id`),
  ADD KEY `ix_cruzamentos_usuario_id` (`usuario_id`),
  ADD KEY `ix_cruzamentos_nome` (`nome`);

--
-- Índices de tabela `publicacoes`
--
ALTER TABLE `publicacoes`
  ADD PRIMARY KEY (`id`),
  ADD KEY `ix_publicacoes_criada_em` (`criada_em`);

--
-- Índices de tabela `usuarios`
--
ALTER TABLE `usuarios`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `ix_usuarios_email` (`email`);

--
-- AUTO_INCREMENT para tabelas despejadas
--

--
-- AUTO_INCREMENT de tabela `cruzamentos`
--
ALTER TABLE `cruzamentos`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de tabela `publicacoes`
--
ALTER TABLE `publicacoes`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de tabela `usuarios`
--
ALTER TABLE `usuarios`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=6;

--
-- Restrições para tabelas despejadas
--

--
-- Restrições para tabelas `cruzamentos`
--
ALTER TABLE `cruzamentos`
  ADD CONSTRAINT `cruzamentos_ibfk_1` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
