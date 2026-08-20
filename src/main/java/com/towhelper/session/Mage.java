package com.towhelper.session;

import java.util.ArrayList;
import java.util.List;

public class Mage {
    public String id;
    public String side = "PLAYER";
    public String casterPresetId = "";
    public String name;
    public String note = "";
    public int level = 1;
    public String loreId = "";
    public List<String> spellIds = new ArrayList<>();
    public List<BoundSpell> boundSpells = new ArrayList<>();
}
