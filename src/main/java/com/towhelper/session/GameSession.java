package com.towhelper.session;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

public class GameSession {
    public String id;
    public String mode = "CONFIG";
    public String playerFactionId = "";
    public String opponentFactionId = "";
    public List<Mage> mages = new ArrayList<>();
    public List<BoundSpell> boundSpells = new ArrayList<>();
    public Set<String> usedCards = new LinkedHashSet<>();
    public String createdAt;
    public String updatedAt;
}
