package br.com.redelhama.auth;

import org.bukkit.Bukkit;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.command.PluginCommand;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitTask;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

public final class RedeLhamaAuth extends JavaPlugin implements CommandExecutor, Listener {

    private static final String PENDING_HEADER = "# code;uuid;nick;expiresAtMillis;vipKeys";
    private static final String LINKED_HEADER = "# uuid;nick;discordId;discordTag;linkedAt;vipKeys";
    private static final long DEFAULT_EXPIRATION_MINUTES = 10L;

    private final SecureRandom secureRandom = new SecureRandom();
    private File pendingCodesFile;
    private File linkedAccountsFile;
    private File statusFile;
    private BukkitTask statusTask;

    @Override
    public void onEnable() {
        saveDefaultConfig();

        if (!getDataFolder().exists() && !getDataFolder().mkdirs()) {
            getLogger().warning("Nao foi possivel criar a pasta do plugin.");
        }

        pendingCodesFile = new File(getDataFolder(), "pending-codes.txt");
        linkedAccountsFile = new File(getDataFolder(), "linked-accounts.txt");
        statusFile = new File(getDataFolder(), getConfig().getString("status.file-name", "server-status.json"));
        ensureFile(pendingCodesFile, PENDING_HEADER);
        ensureFile(linkedAccountsFile, LINKED_HEADER);

        PluginCommand command = getCommand("discord");
        if (command != null) {
            command.setExecutor(this);
        }

        getServer().getPluginManager().registerEvents(this, this);
        startStatusUpdater();
        writeStatusSnapshot(true);

        getLogger().info("Sistema de vinculacao Discord e status local ativado.");
    }

    @Override
    public void onDisable() {
        stopStatusUpdater();
        writeStatusSnapshot(false);
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (args.length == 1 && args[0].equalsIgnoreCase("conectar")) {
            return commandConnect(sender);
        }

        if (args.length == 1 && args[0].equalsIgnoreCase("status")) {
            return commandStatus(sender);
        }

        if (args.length == 1 && args[0].equalsIgnoreCase("reload")) {
            return commandReload(sender);
        }

        sender.sendMessage("Use /discord conectar para gerar seu codigo de vinculacao.");
        return true;
    }

    private boolean commandConnect(CommandSender sender) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage("Use este comando dentro do jogo.");
            return true;
        }

        Optional<LinkedAccount> linkedAccount = findLinkedAccount(player.getUniqueId());
        if (linkedAccount.isPresent()) {
            player.sendMessage("Sua conta ja esta vinculada ao Discord.");
            return true;
        }

        try {
            PendingCode pendingCode = createOrReusePendingCode(player);
            long expiresInMinutes = Math.max(1L, Math.round((pendingCode.expiresAtMillis() - System.currentTimeMillis()) / 60000.0));

            player.sendMessage("Codigo de vinculacao: " + pendingCode.code());
            player.sendMessage("No Discord, clique no painel de vinculacao e informe esse codigo.");
            player.sendMessage("Esse codigo expira em " + expiresInMinutes + " minuto(s).");
        } catch (IOException e) {
            getLogger().severe("Erro gerando codigo de vinculacao: " + e.getMessage());
            player.sendMessage("Nao foi possivel gerar seu codigo agora.");
        }

        return true;
    }

    private boolean commandStatus(CommandSender sender) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage("Use este comando dentro do jogo.");
            return true;
        }

        Optional<LinkedAccount> linkedAccount = findLinkedAccount(player.getUniqueId());
        if (linkedAccount.isPresent()) {
            player.sendMessage("Sua conta esta vinculada ao Discord.");
        } else {
            player.sendMessage("Sua conta ainda nao esta vinculada. Use /discord conectar.");
        }

        return true;
    }

    private boolean commandReload(CommandSender sender) {
        if (!sender.hasPermission("redelhama.discord.admin")) {
            sender.sendMessage("Voce nao tem permissao.");
            return true;
        }

        reloadConfig();
        statusFile = new File(getDataFolder(), getConfig().getString("status.file-name", "server-status.json"));
        stopStatusUpdater();
        startStatusUpdater();
        writeStatusSnapshot(true);
        sender.sendMessage("Configuracao de vinculacao recarregada.");
        return true;
    }

    @EventHandler
    public void onPlayerJoin(PlayerJoinEvent event) {
        scheduleStatusSnapshot();
    }

    @EventHandler
    public void onPlayerQuit(PlayerQuitEvent event) {
        scheduleStatusSnapshot();
    }

    private PendingCode createOrReusePendingCode(Player player) throws IOException {
        long now = System.currentTimeMillis();
        long expiresAtMillis = now + getExpirationMinutes() * 60_000L;
        List<PendingCode> pendingCodes = removeExpiredCodes(readPendingCodes(), now);

        Optional<PendingCode> existingCode = pendingCodes.stream()
                .filter(code -> code.uuid().equals(player.getUniqueId()))
                .findFirst();

        if (existingCode.isPresent()) {
            return existingCode.get();
        }

        String code = generateUniqueCode(pendingCodes);
        PendingCode pendingCode = new PendingCode(
                code,
                player.getUniqueId(),
                sanitizeField(player.getName()),
                expiresAtMillis,
                resolveVipKeys(player)
        );

        pendingCodes.add(pendingCode);
        writePendingCodes(pendingCodes);
        return pendingCode;
    }

    private String generateUniqueCode(List<PendingCode> pendingCodes) {
        for (int attempt = 0; attempt < 100; attempt++) {
            String code = String.format(Locale.ROOT, "%04d", secureRandom.nextInt(10_000));
            boolean exists = pendingCodes.stream().anyMatch(pendingCode -> pendingCode.code().equals(code));
            if (!exists) {
                return code;
            }
        }

        throw new IllegalStateException("Nao foi possivel gerar um codigo unico.");
    }

    private List<String> resolveVipKeys(Player player) {
        ConfigurationSection section = getConfig().getConfigurationSection("vip-permissions");
        if (section == null) {
            return List.of();
        }

        List<String> vipKeys = new ArrayList<>();
        for (String key : section.getKeys(false)) {
            String permission = section.getString(key, "").trim();
            if (!permission.isEmpty() && player.hasPermission(permission)) {
                vipKeys.add(key.toLowerCase(Locale.ROOT));
            }
        }

        vipKeys.sort(String.CASE_INSENSITIVE_ORDER);
        return vipKeys;
    }

    private long getExpirationMinutes() {
        return Math.max(1L, getConfig().getLong("code-expiration-minutes", DEFAULT_EXPIRATION_MINUTES));
    }

    private boolean isStatusEnabled() {
        return getConfig().getBoolean("status.enabled", true);
    }

    private long getStatusUpdateIntervalTicks() {
        return Math.max(20L, getConfig().getLong("status.update-interval-ticks", 100L));
    }

    private String getStatusServerName() {
        String configuredName = getConfig().getString("status.server-name", "").trim();
        if (!configuredName.isEmpty()) {
            return configuredName;
        }

        return Bukkit.getMotd();
    }

    private String getStatusDisplayAddress() {
        return getConfig().getString("status.display-address", "localhost:25565").trim();
    }

    private void startStatusUpdater() {
        if (!isStatusEnabled()) {
            return;
        }

        statusTask = getServer().getScheduler().runTaskTimer(
                this,
                () -> writeStatusSnapshot(true),
                20L,
                getStatusUpdateIntervalTicks()
        );
    }

    private void stopStatusUpdater() {
        if (statusTask != null) {
            statusTask.cancel();
            statusTask = null;
        }
    }

    private void scheduleStatusSnapshot() {
        if (!isStatusEnabled()) {
            return;
        }

        getServer().getScheduler().runTaskLater(this, () -> writeStatusSnapshot(true), 1L);
    }

    private void writeStatusSnapshot(boolean online) {
        if (statusFile == null) {
            return;
        }

        long now = System.currentTimeMillis();
        int playerCount = online ? Bukkit.getOnlinePlayers().size() : 0;
        int maxPlayers = Bukkit.getMaxPlayers();

        List<String> lines = List.of(
                "{",
                "  \"online\": " + online + ",",
                "  \"serverName\": \"" + escapeJson(getStatusServerName()) + "\",",
                "  \"displayAddress\": \"" + escapeJson(getStatusDisplayAddress()) + "\",",
                "  \"players\": " + playerCount + ",",
                "  \"maxPlayers\": " + maxPlayers + ",",
                "  \"version\": \"" + escapeJson(Bukkit.getBukkitVersion()) + "\",",
                "  \"motd\": \"" + escapeJson(Bukkit.getMotd()) + "\",",
                "  \"updatedAtMillis\": " + now,
                "}"
        );

        try {
            writeLinesAtomic(statusFile, lines);
        } catch (IOException e) {
            getLogger().warning("Nao foi possivel atualizar server-status.json: " + e.getMessage());
        }
    }

    private Optional<LinkedAccount> findLinkedAccount(UUID uuid) {
        try {
            return readLinkedAccounts().stream()
                    .filter(account -> account.uuid().equals(uuid))
                    .findFirst();
        } catch (IOException e) {
            getLogger().warning("Nao foi possivel ler linked-accounts.txt: " + e.getMessage());
            return Optional.empty();
        }
    }

    private List<PendingCode> removeExpiredCodes(List<PendingCode> pendingCodes, long now) throws IOException {
        List<PendingCode> activeCodes = pendingCodes.stream()
                .filter(pendingCode -> pendingCode.expiresAtMillis() > now)
                .toList();

        if (activeCodes.size() != pendingCodes.size()) {
            writePendingCodes(activeCodes);
        }

        return new ArrayList<>(activeCodes);
    }

    private List<PendingCode> readPendingCodes() throws IOException {
        ensureFile(pendingCodesFile, PENDING_HEADER);

        List<PendingCode> pendingCodes = new ArrayList<>();
        try (BufferedReader reader = Files.newBufferedReader(pendingCodesFile.toPath(), StandardCharsets.UTF_8)) {
            String line;
            while ((line = reader.readLine()) != null) {
                line = line.trim();
                if (line.isEmpty() || line.startsWith("#")) {
                    continue;
                }

                String[] parts = line.split(";", -1);
                if (parts.length < 4) {
                    continue;
                }

                try {
                    pendingCodes.add(new PendingCode(
                            sanitizeField(parts[0]),
                            UUID.fromString(parts[1].trim()),
                            sanitizeField(parts[2]),
                            Long.parseLong(parts[3].trim()),
                            parseVipKeys(parts.length >= 5 ? parts[4] : "")
                    ));
                } catch (IllegalArgumentException ignored) {
                    getLogger().warning("Linha invalida em pending-codes.txt: " + line);
                }
            }
        }

        return pendingCodes;
    }

    private List<LinkedAccount> readLinkedAccounts() throws IOException {
        ensureFile(linkedAccountsFile, LINKED_HEADER);

        List<LinkedAccount> linkedAccounts = new ArrayList<>();
        try (BufferedReader reader = Files.newBufferedReader(linkedAccountsFile.toPath(), StandardCharsets.UTF_8)) {
            String line;
            while ((line = reader.readLine()) != null) {
                line = line.trim();
                if (line.isEmpty() || line.startsWith("#")) {
                    continue;
                }

                String[] parts = line.split(";", -1);
                if (parts.length < 3) {
                    continue;
                }

                try {
                    linkedAccounts.add(new LinkedAccount(
                            UUID.fromString(parts[0].trim()),
                            sanitizeField(parts[1]),
                            sanitizeField(parts[2])
                    ));
                } catch (IllegalArgumentException ignored) {
                    getLogger().warning("Linha invalida em linked-accounts.txt: " + line);
                }
            }
        }

        return linkedAccounts;
    }

    private void writePendingCodes(List<PendingCode> pendingCodes) throws IOException {
        pendingCodes.sort(Comparator.comparing(PendingCode::code));

        List<String> lines = new ArrayList<>();
        lines.add(PENDING_HEADER);
        for (PendingCode pendingCode : pendingCodes) {
            lines.add(String.join(";",
                    pendingCode.code(),
                    pendingCode.uuid().toString(),
                    sanitizeField(pendingCode.nick()),
                    String.valueOf(pendingCode.expiresAtMillis()),
                    String.join(",", pendingCode.vipKeys())
            ));
        }

        writeLinesAtomic(pendingCodesFile, lines);
    }

    private void ensureFile(File file, String header) {
        if (file.exists()) {
            return;
        }

        try {
            writeLinesAtomic(file, List.of(header));
        } catch (IOException e) {
            getLogger().severe("Nao foi possivel criar " + file.getName() + ": " + e.getMessage());
        }
    }

    private void writeLinesAtomic(File file, List<String> lines) throws IOException {
        if (!file.getParentFile().exists() && !file.getParentFile().mkdirs()) {
            throw new IOException("Nao foi possivel criar a pasta " + file.getParent());
        }

        File tempFile = new File(file.getParentFile(), file.getName() + ".tmp");
        try (BufferedWriter writer = Files.newBufferedWriter(tempFile.toPath(), StandardCharsets.UTF_8)) {
            for (String line : lines) {
                writer.write(line);
                writer.newLine();
            }
        }

        try {
            Files.move(tempFile.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException e) {
            Files.move(tempFile.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING);
        }
    }

    private String escapeJson(String value) {
        StringBuilder escaped = new StringBuilder();
        String normalized = String.valueOf(value == null ? "" : value);

        for (int index = 0; index < normalized.length(); index++) {
            char character = normalized.charAt(index);
            switch (character) {
                case '"' -> escaped.append("\\\"");
                case '\\' -> escaped.append("\\\\");
                case '\b' -> escaped.append("\\b");
                case '\f' -> escaped.append("\\f");
                case '\n' -> escaped.append("\\n");
                case '\r' -> escaped.append("\\r");
                case '\t' -> escaped.append("\\t");
                default -> {
                    if (character < 0x20) {
                        escaped.append(String.format(Locale.ROOT, "\\u%04x", (int) character));
                    } else {
                        escaped.append(character);
                    }
                }
            }
        }

        return escaped.toString();
    }

    private String sanitizeField(String value) {
        return String.valueOf(value == null ? "" : value)
                .trim()
                .replace(";", " ")
                .replace("\r", " ")
                .replace("\n", " ");
    }

    private List<String> parseVipKeys(String value) {
        List<String> vipKeys = new ArrayList<>();
        for (String item : String.valueOf(value == null ? "" : value).split(",")) {
            String key = item.trim().toLowerCase(Locale.ROOT);
            if (!key.isEmpty()) {
                vipKeys.add(key);
            }
        }
        return vipKeys;
    }

    private record PendingCode(String code, UUID uuid, String nick, long expiresAtMillis, List<String> vipKeys) {
    }

    private record LinkedAccount(UUID uuid, String nick, String discordId) {
    }
}
